fn main() {
    // Read version from config file
    let version = get_version_from_config();
    println!("cargo:rustc-env=APP_VERSION={}", version);

    let mut windows = tauri_build::WindowsAttributes::new();

    // Define the manifest with requireAdministrator
    let manifest = r#"
        <assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0">
            <dependency>
                <dependentAssembly>
                    <assemblyIdentity type="win32" name="Microsoft.Windows.Common-Controls" version="6.0.0.0" processorArchitecture="*" publicKeyToken="6595b64144ccf1df" language="*" />
                </dependentAssembly>
            </dependency>
            <trustInfo xmlns="urn:schemas-microsoft-com:asm.v3">
                <security>
                    <requestedPrivileges>
                        <requestedExecutionLevel level="requireAdministrator" uiAccess="false" />
                    </requestedPrivileges>
                </security>
            </trustInfo>
        </assembly>
    "#;

    windows = windows.app_manifest(manifest);

    tauri_build::try_build(tauri_build::Attributes::new().windows_attributes(windows))
        .expect("failed to run build script");
}

fn get_version_from_config() -> String {
    let content = std::fs::read_to_string("tauri.conf.json").unwrap_or_default();
    if let Some(pos) = content.find("\"version\"") {
        let after_key = &content[pos + 9..];
        if let Some(colon_pos) = after_key.find(':') {
            let after_colon = &after_key[colon_pos + 1..];
            if let Some(quote_start) = after_colon.find('"') {
                let after_quote = &after_colon[quote_start + 1..];
                if let Some(quote_end) = after_quote.find('"') {
                    return after_quote[..quote_end].trim().to_string();
                }
            }
        }
    }
    "0.1.0".to_string()
}
