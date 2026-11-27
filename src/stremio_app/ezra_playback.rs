use anyhow::{anyhow, Context, Result};
use libmpv2::Mpv;
use serde::Deserialize;
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};

pub const COMMAND: &str = "ezra-playback";

const PRESETS: &str = include_str!("ezra_assets/presets.json");
const DETECTOR: &str = "fork_bar_detection.lua";
const SHARPENER: &str = "ExpandedSharpness.glsl";
const SHARPNESS_PARAM: &str = "ExpandedSharpness/amount";
const MAX_SHARPENING: u8 = 150;

macro_rules! shaders {
    ($($name:literal),+ $(,)?) => {
        &[$(($name, include_bytes!(concat!("ezra_assets/shaders/", $name)).as_slice())),+]
    };
}

const SHADERS: &[(&str, &[u8])] = shaders![
    "Anime4K_AutoDownscalePre_x2.glsl",
    "Anime4K_AutoDownscalePre_x4.glsl",
    "Anime4K_Clamp_Highlights.glsl",
    "Anime4K_Restore_CNN_M.glsl",
    "Anime4K_Restore_CNN_Soft_M.glsl",
    "Anime4K_Restore_CNN_Soft_VL.glsl",
    "Anime4K_Restore_CNN_VL.glsl",
    "Anime4K_Upscale_CNN_x2_M.glsl",
    "Anime4K_Upscale_CNN_x2_VL.glsl",
    "Anime4K_Upscale_Denoise_CNN_x2_VL.glsl",
    "FSR.glsl",
    "ExpandedSharpness.glsl",
];

#[derive(Deserialize)]
struct Preset {
    label: String,
    files: Vec<String>,
}

pub struct Playback {
    directory: PathBuf,
    presets: Vec<Preset>,
}

fn write_asset(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    if fs::read(path).ok().as_deref() != Some(bytes) {
        fs::write(path, bytes)?;
    }
    Ok(())
}

impl Playback {
    pub fn new(mpv: &Mpv) -> Result<Self> {
        let directory = dirs::data_local_dir()
            .context("Local application data is unavailable")?
            .join(super::constants::APP_DATA_NAME)
            .join("Playback");
        fs::create_dir_all(&directory)?;
        for (name, bytes) in SHADERS {
            write_asset(&directory.join(name), bytes)?;
        }
        let script = directory.join(DETECTOR);
        write_asset(
            &script,
            include_bytes!("ezra_assets/fork_bar_detection.lua"),
        )?;
        mpv.command("load-script", &[&script.to_string_lossy()])
            .context("Could not load black-bar detector")?;

        let state = fs::read_to_string(directory.join("border-blur.txt")).ok();
        if let Some(mode @ ("blur" | "color")) = state.as_deref() {
            if let Err(error) = mpv.set_property("border-background", mode) {
                eprintln!("Could not restore ambient border blur: {error}");
            }
        }
        Ok(Self {
            directory,
            presets: serde_json::from_str(PRESETS)?,
        })
    }

    fn active_shaders(mpv: &Mpv) -> String {
        mpv.get_property::<String>("glsl-shaders")
            .unwrap_or_default()
    }

    fn sharpening_path(&self) -> PathBuf {
        self.directory.join(SHARPENER)
    }

    fn is_sharpening_active(&self, shaders: &str) -> bool {
        let path = self.sharpening_path();
        shaders.split(';').any(|item| Path::new(item) == path)
    }

    fn shader(&self, raw: &str) -> (i64, &str) {
        let sharpener = self.sharpening_path();
        let names = raw
            .split(';')
            .filter(|path| !path.is_empty() && Path::new(path) != sharpener)
            .map(|path| Path::new(path).file_name().and_then(|name| name.to_str()));
        if names.clone().next().is_none() {
            return (0, "Off");
        }
        for (index, preset) in self.presets.iter().enumerate() {
            if names
                .clone()
                .eq(preset.files.iter().map(|name| Some(name.as_str())))
            {
                return (index as i64 + 1, &preset.label);
            }
        }
        (-1, "Custom shaders")
    }

    fn set_upscaling(&self, mpv: &Mpv, files: &[String]) -> Result<()> {
        let mut paths = files
            .iter()
            .map(|name| self.directory.join(name).to_string_lossy().into_owned())
            .collect::<Vec<_>>();
        if self.is_sharpening_active(&Self::active_shaders(mpv)) {
            paths.push(self.sharpening_path().to_string_lossy().into_owned());
        }
        if paths.iter().any(|path| path.contains(';')) {
            return Err(anyhow!("Shader paths cannot contain semicolons"));
        }
        mpv.command("change-list", &["glsl-shaders", "set", &paths.join(";")])?;
        Ok(())
    }

    fn set_sharpening(&self, mpv: &Mpv, amount: u8) -> Result<()> {
        let path = self.sharpening_path();
        let active = self.is_sharpening_active(&Self::active_shaders(mpv));
        if amount == 0 {
            if active {
                mpv.command(
                    "change-list",
                    &["glsl-shaders", "remove", &path.to_string_lossy()],
                )?;
            }
            mpv.command(
                "change-list",
                &["glsl-shader-opts", "remove", SHARPNESS_PARAM],
            )?;
            return Ok(());
        }
        if path.to_string_lossy().contains(';') {
            return Err(anyhow!("Shader paths cannot contain semicolons"));
        }
        mpv.command(
            "change-list",
            &[
                "glsl-shader-opts",
                "add",
                &format!("{SHARPNESS_PARAM}={amount}"),
            ],
        )?;
        if !active {
            mpv.command(
                "change-list",
                &["glsl-shaders", "append", &path.to_string_lossy()],
            )?;
        }
        Ok(())
    }

    pub fn status(&self, mpv: &Mpv) -> Value {
        let detector = mpv
            .get_property::<String>("user-data/stremio-bar-detection")
            .ok()
            .and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
            .unwrap_or_default();
        let shaders = Self::active_shaders(mpv);
        let (shader, shader_name) = self.shader(&shaders);
        let output = mpv.get_property::<String>("current-vo").ok();
        let sharpening_available = output.as_deref() == Some("gpu-next");
        let sharpening = if sharpening_available && self.is_sharpening_active(&shaders) {
            mpv.get_property::<String>("glsl-shader-opts")
                .ok()
                .and_then(|options| {
                    options.split(',').find_map(|option| {
                        let (key, value) = option.split_once('=')?;
                        (key == SHARPNESS_PARAM)
                            .then_some(value)?
                            .parse::<u8>()
                            .ok()
                    })
                })
                .unwrap_or_default()
                .min(MAX_SHARPENING)
        } else {
            0
        };
        let blur = mpv
            .get_property::<String>("border-background")
            .is_ok_and(|mode| mode == "blur");
        let width = mpv
            .get_property::<i64>("video-params/w")
            .unwrap_or_default();
        let height = mpv
            .get_property::<i64>("video-params/h")
            .unwrap_or_default();
        let ready = width > 0 && height > 0;
        let label = |prop| {
            mpv.get_property::<String>(prop).ok().filter(|text| {
                text.len() <= 48
                    && text
                        .bytes()
                        .all(|byte| byte.is_ascii_alphanumeric() || b"-_.".contains(&byte))
            })
        };
        let crop = detector["state"].as_str().unwrap_or("idle");
        let crop_active = detector["crop"].as_str().is_some_and(|value| {
            !value.is_empty()
                && mpv.get_property::<String>("video-crop").ok().as_deref() == Some(value)
        });
        let crop = if crop == "locked" && !crop_active {
            "idle"
        } else {
            crop
        };
        let filter = mpv
            .get_property::<String>("vf")
            .ok()
            .filter(|value| !value.is_empty());
        let report = ready.then(|| {
            json!({
                "version": env!("CARGO_PKG_VERSION"),
                "resolution": format!("{width} x {height}"),
                "codec": label("video-format"),
                "hardwareDecoder": label("hwdec-current").filter(|value| value != "no"),
                "output": label("current-vo"),
                "fps": mpv.get_property::<f64>("container-fps").ok(),
                "renderDropped": mpv.get_property::<i64>("frame-drop-count").ok(),
                "decoderDropped": mpv.get_property::<i64>("decoder-frame-drop-count").ok(),
                "buffering": mpv.get_property::<bool>("paused-for-cache").ok(),
                "bufferPercent": mpv.get_property::<i64>("cache-buffering-state").ok(),
                "bufferSeconds": mpv.get_property::<f64>("demuxer-cache-duration").ok(),
                "videoFilters": filter.is_some(),
            "gpuScaling": filter.as_deref().is_some_and(|value| value.contains("d3d11vpp") &&
                value.contains("scaling-mode=nvidia")),
            "gpuHdr": filter.as_deref().is_some_and(|value| value.contains("d3d11vpp") &&
                value.contains("nvidia-true-hdr")),
                "upscaling": shader_name,
                "sharpening": sharpening,
                "borderBlur": blur,
                "blackBarCrop": crop_active,
            })
        });
        json!({"ready": ready, "blur": blur, "shader": shader, "crop": crop,
            "cropMessage": detector["message"], "sharpeningAvailable": sharpening_available,
            "sharpening": sharpening, "report": report})
    }

    pub fn handle(&self, mpv: &Mpv, action: &str) -> Result<()> {
        if mpv.get_property::<i64>("video-params/w").unwrap_or(0) <= 0 {
            return Ok(());
        }
        match action {
            "detect" => mpv.command("script-message-to", &["fork_bar_detection", "detect"])?,
            "blur" => {
                let enabled = mpv.get_property::<String>("border-background")? != "blur";
                let mode = if enabled { "blur" } else { "color" };
                mpv.set_property("border-background", mode)?;
                fs::write(self.directory.join("border-blur.txt"), mode)?;
                let text = if enabled {
                    "Ambient border blur: On"
                } else {
                    "Ambient border blur: Off"
                };
                mpv.command("show-text", &[text])?;
            }
            "clear" => {
                self.set_sharpening(mpv, 0)?;
                mpv.command("change-list", &["glsl-shaders", "clr", ""])?;
                mpv.command("show-text", &["GLSL shaders cleared"])?;
            }
            "upscaling-off" => {
                self.set_upscaling(mpv, &[])?;
                mpv.command("show-text", &["Upscaling: Off"])?;
            }
            action if action.starts_with("sharpen-") => {
                let amount = action["sharpen-".len()..]
                    .parse::<u8>()
                    .ok()
                    .filter(|amount| *amount <= MAX_SHARPENING)
                    .ok_or_else(|| anyhow!("Invalid sharpening amount"))?;
                if amount > 0 && mpv.get_property::<String>("current-vo")?.as_str() != "gpu-next" {
                    return Err(anyhow!("Enhancement requires gpu-next"));
                }
                self.set_sharpening(mpv, amount)?;
            }
            preset => {
                let preset = preset
                    .strip_prefix("shader-")
                    .and_then(|number| number.parse::<usize>().ok())
                    .and_then(|number| number.checked_sub(1))
                    .and_then(|index| self.presets.get(index))
                    .ok_or_else(|| anyhow!("Unknown playback action"))?;
                self.set_upscaling(mpv, &preset.files)?;
                mpv.command("show-text", &[&preset.label])?;
            }
        }
        Ok(())
    }
}
