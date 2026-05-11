#[cfg(test)]
mod tests {
    use crate::acp::types::*;
    use crate::acp::discovery::*;

    #[test]
    fn test_provider_descriptor_serialization() {
        let desc = ProviderDescriptor {
            id: "test".to_string(),
            name: "Test Provider".to_string(),
            endpoint: "ws://localhost:18789".to_string(),
            auth_type: AuthType::Local,
            config_dir: None,
        };
        let json = serde_json::to_string(&desc).unwrap();
        assert!(json.contains("\"id\":\"test\""));
    }

    #[test]
    fn test_discovery_logic() {
        // 这是一个冒烟测试，因为环境里可能没有 .openclaw 目录
        let providers = discover_local_providers();
        println!("Discovered {} providers", providers.len());
    }
}
