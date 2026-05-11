use serde::{Deserialize, Serialize};


#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderDescriptor {
    pub id: String,
    pub name: String,
    pub endpoint: String, // ws://... 或 path://...
    pub auth_type: AuthType,
    pub config_dir: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum AuthType {
    Local,
    StaticToken(String),
    ChallengeResponse,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AcpCapabilities {
    pub supports_files: bool,
    pub supports_terminal: bool,
    pub supports_reasoning: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentModel {
    pub id: String,
    pub name: String,
    pub provider_id: String,
    pub capabilities: Option<AcpCapabilities>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Identity {
    pub device_id: String,
    pub public_key: String,
    #[serde(skip)]
    pub private_key: Option<String>,
}
