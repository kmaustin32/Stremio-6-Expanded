use std::path::{Path, PathBuf};

pub fn user_data_folder(executable: &Path) -> PathBuf {
    let legacy = executable.with_file_name("Stremio6-Custom.exe.WebView2");
    if legacy.is_dir() {
        return legacy;
    }
    let mut name = executable.as_os_str().to_os_string();
    name.push(".WebView2");
    PathBuf::from(name)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn renamed_app_reuses_existing_browser_profile() {
        let root = std::env::temp_dir().join(format!("expanded-profile-{}", uuid::Uuid::new_v4()));
        let executable = root.join("Stremio 6 Expanded.exe");
        assert_eq!(
            user_data_folder(&executable),
            root.join("Stremio 6 Expanded.exe.WebView2")
        );
        let legacy = root.join("Stremio6-Custom.exe.WebView2");
        std::fs::create_dir_all(&legacy).unwrap();
        assert_eq!(user_data_folder(&executable), legacy);
        std::fs::remove_dir(&legacy).unwrap();
        std::fs::remove_dir(&root).unwrap();
    }
}
