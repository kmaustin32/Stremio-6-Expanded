use anyhow::{bail, ensure, Context, Result};
use reqwest::{blocking::Client, redirect::Policy};
use semver::Version;
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File},
    io::{Read, Write},
    os::windows::process::CommandExt,
    path::{Path, PathBuf},
    process::Command,
    time::Duration,
};
use winapi::um::winbase::CREATE_BREAKAWAY_FROM_JOB;

pub const COMMAND: &str = "expanded-updates";
const REPO: &str = "kmaustin32/Stremio-6-Expanded";
const MAX_BYTES: u64 = 250 * 1024 * 1024;

#[derive(Deserialize)]
struct Release {
    tag_name: String,
    draft: bool,
    prerelease: bool,
    assets: Vec<Asset>,
}

#[derive(Clone, Deserialize)]
struct Asset {
    name: String,
    size: u64,
    digest: Option<String>,
}

struct Candidate {
    version: Version,
    tag: String,
    asset: Asset,
}

fn release_version(tag: &str, prerelease: bool) -> Option<Version> {
    let version: Version = if prerelease {
        tag.strip_prefix('v')?.parse().ok()?
    } else {
        tag.strip_prefix("custom-v")?.parse().ok()?
    };
    if !version.build.is_empty() {
        return None;
    }
    if prerelease {
        let number = version.pre.as_str().strip_prefix("custom.")?;
        if number.parse::<u32>().ok()? == 0 || !number.bytes().all(|byte| byte.is_ascii_digit()) {
            return None;
        }
    } else if !version.pre.is_empty() {
        return None;
    }
    Some(version)
}

fn sha256(asset: &Asset) -> Option<&str> {
    let digest = asset.digest.as_deref()?.strip_prefix("sha256:")?;
    (digest.len() == 64 && digest.bytes().all(|byte| byte.is_ascii_hexdigit())).then_some(digest)
}

fn choose(
    releases: Vec<Release>,
    current: &Version,
    beta: bool,
    portable: bool,
) -> Option<Candidate> {
    releases
        .into_iter()
        .filter(|release| !release.draft && (beta || !release.prerelease))
        .filter_map(|release| {
            let version = release_version(&release.tag_name, release.prerelease)?;
            if &version <= current {
                return None;
            }
            let suffix = if portable { ".zip" } else { "-Setup.exe" };
            let name = format!("Stremio-6-Expanded-{version}-x64{suffix}");
            let asset = release.assets.into_iter().find(|asset| {
                asset.name == name
                    && (1..=MAX_BYTES).contains(&asset.size)
                    && sha256(asset).is_some()
            })?;
            Some(Candidate {
                version,
                tag: release.tag_name,
                asset,
            })
        })
        .max_by(|a, b| a.version.cmp(&b.version))
}

fn client() -> Result<Client> {
    Ok(Client::builder()
        .user_agent("Stremio-6-Expanded")
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(180))
        .redirect(Policy::custom(|attempt| {
            if attempt.previous().len() >= 4 {
                return attempt.error("Too many download redirects");
            }
            let url = attempt.url();
            if url.scheme() == "https"
                && matches!(
                    url.host_str(),
                    Some(
                        "github.com"
                            | "release-assets.githubusercontent.com"
                            | "objects.githubusercontent.com"
                    )
                )
            {
                attempt.follow()
            } else {
                attempt.error("Unexpected download redirect")
            }
        }))
        .build()?)
}

fn verify(mut input: impl Read, mut output: impl Write, asset: &Asset) -> Result<()> {
    let expected = sha256(asset).context("Missing GitHub checksum")?;
    let mut hash = Sha256::new();
    let mut buffer = [0; 64 * 1024];
    let mut total = 0;
    loop {
        let length = input.read(&mut buffer)?;
        if length == 0 {
            break;
        }
        total += length as u64;
        ensure!(total <= asset.size, "Download size does not match GitHub");
        hash.update(&buffer[..length]);
        output.write_all(&buffer[..length])?;
    }
    ensure!(total == asset.size, "Download size does not match GitHub");
    ensure!(
        format!("{:x}", hash.finalize()).eq_ignore_ascii_case(expected),
        "Download checksum does not match GitHub"
    );
    Ok(())
}

pub struct Updates {
    candidate: Option<Candidate>,
    downloaded: Option<(PathBuf, Asset)>,
    portable: bool,
}

impl Updates {
    pub fn new() -> Self {
        let installed = std::env::current_exe()
            .ok()
            .is_some_and(|path| path.with_file_name("unins000.exe").is_file());
        Self {
            candidate: None,
            downloaded: None,
            portable: !installed,
        }
    }

    fn check(&mut self, channel: &str) -> Result<Value> {
        self.candidate = None;
        let beta = match channel {
            "stable" => false,
            "beta" => true,
            _ => bail!("Invalid update channel"),
        };
        let current: Version = env!("CARGO_PKG_VERSION").parse()?;
        let releases: Vec<Release> = client()?
            .get(format!(
                "https://api.github.com/repos/{REPO}/releases?per_page=100"
            ))
            .timeout(Duration::from_secs(20))
            .send()?
            .error_for_status()?
            .json()?;
        self.candidate = choose(releases, &current, beta, self.portable);
        let version = self.candidate.as_ref().map(|item| item.version.to_string());
        Ok(json!({"available": version}))
    }

    fn download(&mut self, version: &str) -> Result<Value> {
        let candidate = self.candidate.as_ref().context("Check for updates first")?;
        ensure!(
            candidate.version.to_string() == version,
            "Check for updates again"
        );
        let base = if self.portable {
            dirs::download_dir().context("Windows Downloads folder is unavailable")?
        } else {
            std::env::temp_dir()
        };
        let directory = base.join(format!("Stremio-6-Expanded-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&directory)?;
        let path = directory.join(&candidate.asset.name);
        let result = (|| {
            let response = client()?
                .get(format!(
                    "https://github.com/{REPO}/releases/download/{}/{}",
                    candidate.tag, candidate.asset.name
                ))
                .send()?
                .error_for_status()?;
            let mut file = File::create_new(&path)?;
            verify(response, &mut file, &candidate.asset)?;
            file.sync_all()?;
            Ok::<_, anyhow::Error>(())
        })();
        if let Err(error) = result {
            let _ = fs::remove_file(&path);
            let _ = fs::remove_dir(&directory);
            return Err(error);
        }
        let previous = self.downloaded.replace((path, candidate.asset.clone()));
        if let Some((old, _)) = previous.filter(|_| !self.portable) {
            let _ = fs::remove_file(&old);
            if let Some(parent) = old.parent() {
                let _ = fs::remove_dir(parent);
            }
        }
        Ok(json!({"downloaded": true}))
    }

    fn open_download(&self, version: &str, path: &Path, asset: &Asset) -> Result<()> {
        let candidate = self.candidate.as_ref().context("Check for updates first")?;
        ensure!(
            candidate.version.to_string() == version && sha256(&candidate.asset) == sha256(asset),
            "Download the selected release first"
        );
        if self.portable {
            open::that_detached(path.parent().context("Missing download folder")?)?;
        } else {
            verify(File::open(path)?, std::io::sink(), asset)?;
            Command::new(path)
                .creation_flags(CREATE_BREAKAWAY_FROM_JOB)
                .spawn()
                .context("Could not open the verified installer")?;
        }
        Ok(())
    }

    pub fn handle(&mut self, request: &Value) -> (Value, bool) {
        let mut quit = false;
        let action = request["action"].as_str().unwrap_or_default();
        let result = match action {
            "info" => Ok(json!({"version": env!("CARGO_PKG_VERSION"), "portable": self.portable})),
            "check" => self.check(request["channel"].as_str().unwrap_or_default()),
            "download" => self.download(request["version"].as_str().unwrap_or_default()),
            "open" => self
                .downloaded
                .as_ref()
                .context("Download an update first")
                .and_then(|(path, asset)| {
                    self.open_download(request["version"].as_str().unwrap_or_default(), path, asset)
                })
                .map(|()| {
                    quit = !self.portable;
                    json!({"opened": true})
                }),
            _ => Err(anyhow::anyhow!("Invalid update request")),
        };
        let mut response = result.unwrap_or_else(|error| {
            eprintln!("Expanded update {action} failed: {error:#}");
            let message = if action == "check" {
                "Could not check GitHub for updates. Try again later."
            } else if action == "download" {
                "The update could not be downloaded or verified. Check for updates and try again."
            } else {
                "Could not open the verified download."
            };
            json!({"error": message})
        });
        response["requestId"] = request["requestId"].clone();
        (response, quit)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn picks_newer_verified_channel_and_correct_package() {
        let asset = |version: &str, suffix| Asset {
            name: format!("Stremio-6-Expanded-{version}-x64{suffix}"),
            digest: Some(format!("sha256:{}", "1".repeat(64))),
            size: 123,
        };
        let releases = || {
            vec![
                Release {
                    tag_name: "v5.0.36-custom.1".into(),
                    draft: true,
                    prerelease: true,
                    assets: vec![asset("5.0.36-custom.1", "-Setup.exe")],
                },
                Release {
                    tag_name: "v5.0.35-custom.2".into(),
                    draft: false,
                    prerelease: true,
                    assets: vec![asset("5.0.35-custom.2", "-Setup.exe")],
                },
                Release {
                    tag_name: "custom-v5.0.35".into(),
                    draft: false,
                    prerelease: false,
                    assets: vec![Asset {
                        digest: None,
                        ..asset("5.0.35", "-Setup.exe")
                    }],
                },
                Release {
                    tag_name: "custom-v5.0.34".into(),
                    draft: false,
                    prerelease: false,
                    assets: vec![asset("5.0.34", "-Setup.exe"), asset("5.0.34", ".zip")],
                },
            ]
        };
        let current = Version::parse("5.0.34-custom.1").unwrap();
        assert_eq!(
            choose(releases(), &current, false, false).unwrap().tag,
            "custom-v5.0.34"
        );
        assert_eq!(
            choose(releases(), &current, true, false).unwrap().tag,
            "v5.0.35-custom.2"
        );
        assert_eq!(
            choose(releases(), &current, true, true).unwrap().asset.name,
            "Stremio-6-Expanded-5.0.34-x64.zip"
        );
        assert!(choose(releases(), &Version::parse("5.0.36").unwrap(), true, false).is_none());
        assert!(release_version("v5.0.35-rc.1", true).is_none());
    }

    #[test]
    fn rejects_truncated_oversize_and_corrupt_downloads() {
        let asset = Asset {
            name: "test".into(),
            size: 3,
            digest: Some(format!("sha256:{:x}", Sha256::digest(b"abc"))),
        };
        assert!(verify(&b"abc"[..], std::io::sink(), &asset).is_ok());
        for bad in [&b"ab"[..], &b"abcd"[..], &b"xyz"[..]] {
            assert!(verify(bad, std::io::sink(), &asset).is_err());
        }
    }
}
