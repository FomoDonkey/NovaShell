use serde::{Deserialize, Serialize};

const OLLAMA_URL: &str = "http://localhost:11434";

const MODEL_DOCS: &str = "llama3.2";

#[derive(Serialize, Deserialize, Clone)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Deserialize)]
struct OllamaChatResponse {
    message: Option<OllamaMessage>,
    error: Option<String>,
}

#[derive(Deserialize)]
struct OllamaMessage {
    content: String,
}

#[derive(Deserialize, Serialize, Clone)]
pub struct OllamaModel {
    pub name: String,
    pub size: u64,
}

#[derive(Deserialize)]
struct OllamaTagsResponse {
    models: Option<Vec<OllamaModel>>,
}

use std::sync::OnceLock;

static HTTP_CLIENT: OnceLock<reqwest::Client> = OnceLock::new();

fn client() -> &'static reqwest::Client {
    HTTP_CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(120))
            .pool_max_idle_per_host(2)
            .build()
            .unwrap_or_default()
    })
}

/// Check if Ollama is running
pub async fn check_health() -> Result<bool, String> {
    match client().get(OLLAMA_URL).send().await {
        Ok(r) => Ok(r.status().is_success()),
        Err(_) => Ok(false),
    }
}

/// List installed models
pub async fn list_models() -> Result<Vec<OllamaModel>, String> {
    let resp = client()
        .get(format!("{}/api/tags", OLLAMA_URL))
        .send()
        .await
        .map_err(|e| format!("Cannot connect to Ollama: {}", e))?;

    let parsed: OllamaTagsResponse = resp.json().await.map_err(|e| format!("Parse error: {}", e))?;
    Ok(parsed.models.unwrap_or_default())
}

/// Pull a model (blocking — waits for completion)
pub async fn pull_model(model: &str) -> Result<(), String> {
    let body = serde_json::json!({ "name": model, "stream": false });
    let resp = client()
        .post(format!("{}/api/pull", OLLAMA_URL))
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Pull request failed: {}", e))?;

    if !resp.status().is_success() {
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("Pull failed: {}", text));
    }
    // Wait for response body (pull completes when response is received with stream:false)
    let _ = resp.text().await;
    Ok(())
}

/// Chat with a model
pub async fn chat(
    model: &str,
    system_prompt: &str,
    messages: &[ChatMessage],
) -> Result<String, String> {
    let mut api_messages = Vec::with_capacity(messages.len() + 1);
    api_messages.push(serde_json::json!({
        "role": "system",
        "content": system_prompt
    }));
    for m in messages {
        api_messages.push(serde_json::json!({
            "role": m.role,
            "content": m.content
        }));
    }

    let body = serde_json::json!({
        "model": model,
        "messages": api_messages,
        "stream": false,
        "options": {
            "temperature": 0.3,
            "num_predict": 2048
        }
    });

    let resp = client()
        .post(format!("{}/api/chat", OLLAMA_URL))
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Ollama request failed: {}", e))?;

    let status = resp.status();
    let text = resp.text().await.map_err(|e| format!("Read error: {}", e))?;

    if !status.is_success() {
        return Err(format!("Ollama error ({}): {}", status, &text[..text.len().min(300)]));
    }

    let parsed: OllamaChatResponse =
        serde_json::from_str(&text).map_err(|e| format!("Parse error: {}", e))?;

    if let Some(err) = parsed.error {
        return Err(err);
    }
    parsed
        .message
        .map(|m| m.content)
        .ok_or_else(|| "No response from model".to_string())
}

// ──────────── Session Documentation ────────────

pub async fn generate_session_doc(
    commands: &[String],
    errors: &[String],
    duration_minutes: u64,
) -> Result<String, String> {
    let prompt = format!(
        r###"Write professional technical documentation for this terminal session. Write it as a fluid, readable narrative — NOT a dry list of commands.

SESSION DATA:
- Duration: {} minutes
- Commands ({} total): {}
{}

WRITING STYLE:
- Start with a title (# Session Report) and a brief overview paragraph describing the session goal and outcome
- Organize into logical sections with clear ## headings based on what was accomplished (e.g., "## Project Setup", "## Debugging Network Issues")
- For each section, write a short narrative explaining WHAT was done and WHY, then show the relevant commands in code blocks
- After each command or group of commands, explain what it does and what the expected result is — assume the reader may not know every flag or tool
- If there were errors, dedicate a section to "## Issues Encountered" explaining each error in plain language and how it was addressed
- End with a "## Summary" section with key takeaways and results
- Write in the same language the commands/context suggest (default: English)
- Be professional, clear, and educational — this should read like a well-written tutorial, not a log dump"###,
        duration_minutes,
        commands.len(),
        commands
            .iter()
            .map(|c| format!("`{}`", c))
            .collect::<Vec<_>>()
            .join(", "),
        if errors.is_empty() {
            "No errors during session.".to_string()
        } else {
            format!(
                "Errors ({}):\n{}",
                errors.len(),
                errors
                    .iter()
                    .map(|e| format!("- {}", e))
                    .collect::<Vec<_>>()
                    .join("\n")
            )
        }
    );

    let messages = vec![ChatMessage {
        role: "user".to_string(),
        content: prompt,
    }];

    chat(
        MODEL_DOCS,
        "You are a senior technical writer. You produce clear, professional documentation that reads like a polished guide — fluid prose with well-explained commands, not just bullet lists. Every command you mention gets a brief explanation of what it does. Your writing is structured, educational, and easy to follow.",
        &messages,
    )
    .await
}

pub async fn generate_session_doc_with_template(
    commands: &[String],
    errors: &[String],
    duration_minutes: u64,
    template_structure: &str,
) -> Result<String, String> {
    let prompt = format!(
        r###"Write professional technical documentation for this terminal session.

The user has provided a REFERENCE DOCUMENT as an example of their preferred style and structure. Follow this structure, tone, and formatting closely when organizing your documentation:

{template}

---

SESSION DATA:
- Duration: {duration} minutes
- Commands ({cmd_count} total): {commands}
{errors}

INSTRUCTIONS:
- Follow the reference document's structure and style as closely as possible
- Start with a title (# Session Report) and overview
- Organize into sections matching the reference style
- For each section, explain WHAT was done and WHY, then show commands in code blocks
- After each command, explain what it does — assume the reader may not know every flag
- If there were errors, explain them in plain language
- End with a Summary section
- Write in the same language the commands/context suggest (default: English)
- Make it professional, clear, and educational"###,
        template = template_structure,
        duration = duration_minutes,
        cmd_count = commands.len(),
        commands = commands
            .iter()
            .map(|c| format!("`{}`", c))
            .collect::<Vec<_>>()
            .join(", "),
        errors = if errors.is_empty() {
            "No errors during session.".to_string()
        } else {
            format!(
                "Errors ({}):\n{}",
                errors.len(),
                errors
                    .iter()
                    .map(|e| format!("- {}", e))
                    .collect::<Vec<_>>()
                    .join("\n")
            )
        }
    );

    let messages = vec![ChatMessage {
        role: "user".to_string(),
        content: prompt,
    }];

    chat(
        MODEL_DOCS,
        "You are a senior technical writer. You produce clear, professional documentation that reads like a polished guide — fluid prose with well-explained commands, not just bullet lists. Every command you mention gets a brief explanation of what it does. Your writing is structured, educational, and easy to follow. You adapt your style to match the reference document provided by the user.",
        &messages,
    )
    .await
}
