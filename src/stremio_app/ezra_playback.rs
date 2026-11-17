use anyhow::{anyhow, Context, Result};
use libmpv2::Mpv;
use serde::Deserialize;
use std::fs;
use std::path::{Path, PathBuf};

pub const COMMAND: &str = "ezra-playback";

const PRESETS: &str = include_str!("ezra_assets/presets.json");
const DETECTOR: &str = "fork_bar_detection.lua";

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
            .join("Stremio6-Custom")
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
                mpv.command("change-list", &["glsl-shaders", "clr", ""])?;
                mpv.command("show-text", &["GLSL shaders cleared"])?;
            }
            preset => {
                let preset = preset
                    .strip_prefix("shader-")
                    .and_then(|number| number.parse::<usize>().ok())
                    .and_then(|number| number.checked_sub(1))
                    .and_then(|index| self.presets.get(index))
                    .ok_or_else(|| anyhow!("Unknown playback action"))?;
                let paths = preset
                    .files
                    .iter()
                    .map(|name| self.directory.join(name).to_string_lossy().into_owned())
                    .collect::<Vec<_>>();
                if paths.iter().any(|path| path.contains(';')) {
                    return Err(anyhow!("Shader paths cannot contain semicolons"));
                }
                mpv.command("change-list", &["glsl-shaders", "set", &paths.join(";")])?;
                mpv.command("show-text", &[&preset.label])?;
            }
        }
        Ok(())
    }
}
