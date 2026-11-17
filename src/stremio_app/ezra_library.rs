use anyhow::{anyhow, ensure, Context, Result};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{fs, io::ErrorKind, path::Path};

pub const COMMAND: &str = "fork-library-store";
const MAX_SIZE: u64 = 8 * 1024 * 1024;

fn validate(lists: &Value) -> Result<()> {
    let lists = lists.as_array().context("Saved lists could not be read")?;
    let mut ids = std::collections::HashSet::new();
    for list in lists {
        let id = list["id"].as_str().unwrap_or_default();
        ensure!(
            !id.is_empty()
                && id
                    .bytes()
                    .all(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit() || ch == b'-')
                && !matches!(id, "all" | "most-watched" | "watched" | "not-watched")
                && ids.insert(id)
                && list["name"]
                    .as_str()
                    .is_some_and(|name| !name.trim().is_empty())
                && list["items"].as_array().is_some_and(|items| items
                    .iter()
                    .all(|id| id.as_str().is_some_and(|id| !id.is_empty()))),
            "Saved lists could not be read"
        );
    }
    Ok(())
}

fn read(path: &Path) -> Result<Option<Value>> {
    match fs::metadata(path) {
        Ok(info) => ensure!(info.len() <= MAX_SIZE, "Saved lists are too large"),
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.into()),
    }
    let record: Value = serde_json::from_slice(&fs::read(path)?)?;
    ensure!(
        record["version"] == 1 && record["revision"].is_u64(),
        "Saved lists could not be read"
    );
    validate(&record["lists"])?;
    Ok(Some(record))
}

fn write(path: &Path, record: &Value) -> Result<()> {
    let bytes = serde_json::to_vec(record)?;
    ensure!(bytes.len() as u64 <= MAX_SIZE, "Saved lists are too large");
    fs::create_dir_all(path.parent().context("Missing Library location")?)?;
    let temp = path.with_extension(format!("{}.tmp", uuid::Uuid::new_v4()));
    fs::write(&temp, bytes)?;
    if let Err(error) = fs::rename(&temp, path) {
        let _ = fs::remove_file(&temp);
        return Err(error.into());
    }
    Ok(())
}

fn process(request: &Value) -> Result<Value> {
    let uid = request["uid"].as_str().context("Invalid Library account")?;
    ensure!(
        !uid.is_empty() && uid.len() <= 256,
        "Invalid Library account"
    );
    let data = dirs::data_local_dir().context("Local Library storage is unavailable")?;
    let filename = format!("{:x}.json", Sha256::digest(uid.as_bytes()));
    let path = data.join("Stremio6-Custom").join("Library").join(&filename);
    let mut record = match read(&path)? {
        Some(record) => record,
        None => {
            let previous = data.join("EzrasStremio").join("Library").join(&filename);
            let lists = read(&previous)?.map(|record| record["lists"].clone());
            let legacy = request["legacy"].as_str().and_then(|raw| {
                (raw.len() as u64 <= MAX_SIZE)
                    .then(|| serde_json::from_str::<Value>(raw).ok())
                    .flatten()
                    .filter(|record| record["version"] == 1 && validate(&record["lists"]).is_ok())
                    .map(|record| record["lists"].clone())
            });
            let initial = json!({"version": 1, "revision": 0,
                "lists": lists.or(legacy).unwrap_or_else(|| json!([]))});
            write(&path, &initial)?;
            initial
        }
    };
    let revision = record["revision"].as_u64().unwrap_or_default();
    let conflict = match request["action"].as_str() {
        Some("load") => false,
        Some("save") if request["revision"].as_u64() == Some(revision) => {
            validate(&request["lists"])?;
            record = json!({"version": 1, "revision": revision.checked_add(1).context("Library revision overflow")?,
                "lists": request["lists"]});
            write(&path, &record)?;
            false
        }
        Some("save") => true,
        _ => return Err(anyhow!("Invalid Library request")),
    };
    Ok(json!({"record": record, "conflict": conflict}))
}

pub fn handle(request: &Value) -> Value {
    let mut result = process(request).unwrap_or_else(|error| json!({"error": error.to_string()}));
    result["requestId"] = request["requestId"].clone();
    result
}
