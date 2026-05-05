use rusqlite::{params, Connection, Result};
use std::path::PathBuf;
use std::fs;

pub struct Db {
    conn: Connection,
}

impl Db {
    pub fn new() -> Result<Self> {
        let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
        let db_dir = PathBuf::from(format!("{}/.openclaw/data", home));
        if !db_dir.exists() {
            let _ = fs::create_dir_all(&db_dir);
        }
        let db_path = db_dir.join("jiling-tasks.db");
        Self::new_with_path(db_path.to_str().unwrap())
    }

    pub fn new_with_path(path: &str) -> Result<Self> {
        let conn = Connection::open(path)?;

        // 初始化表
        conn.execute(
            "CREATE TABLE IF NOT EXISTS tasks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                run_id TEXT UNIQUE,
                agent_id TEXT,
                status TEXT, -- pending, submitted, running, completed, failed, cancelled, lost
                message TEXT,
                output TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )",
            [],
        )?;

        Ok(Db { conn })
    }

    pub fn insert_task(&self, run_id: &str, agent_id: &str, message: &str) -> Result<()> {
        self.conn.execute(
            "INSERT INTO tasks (run_id, agent_id, status, message, output) VALUES (?, ?, 'submitted', ?, '')",
            params![run_id, agent_id, message],
        )?;
        Ok(())
    }

    pub fn update_task_status(&self, run_id: &str, status: &str) -> Result<()> {
        self.conn.execute(
            "UPDATE tasks SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE run_id = ?",
            params![status, run_id],
        )?;
        Ok(())
    }

    pub fn append_task_output(&self, run_id: &str, delta: &str) -> Result<()> {
        self.conn.execute(
            "UPDATE tasks SET output = output || ?, updated_at = CURRENT_TIMESTAMP WHERE run_id = ?",
            params![delta, run_id],
        )?;
        Ok(())
    }

    pub fn get_in_progress_tasks(&self) -> Result<Vec<(String, String)>> {
        let mut stmt = self.conn.prepare("SELECT run_id, agent_id FROM tasks WHERE status IN ('submitted', 'running', 'reconciling')")?;
        let task_iter = stmt.query_map([], |row| {
            Ok((row.get(0)?, row.get(1)?))
        })?;

        let mut tasks = Vec::new();
        for task in task_iter {
            tasks.push(task?);
        }
        Ok(tasks)
    }

    pub fn get_task_output(&self, run_id: &str) -> Result<String> {
        self.conn.query_row(
            "SELECT output FROM tasks WHERE run_id = ?",
            params![run_id],
            |row| row.get(0),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn test_db_lifecycle() {
        let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
        let db_path = format!("{}/.openclaw/data/jiling-tasks-test.db", home);
        let db_dir = std::path::Path::new(&db_path).parent().unwrap();
        if !db_dir.exists() {
            let _ = fs::create_dir_all(db_dir);
        }
        if std::path::Path::new(&db_path).exists() {
            let _ = fs::remove_file(&db_path);
        }

        let db = Db::new_with_path(&db_path).unwrap();

        // Test Insert
        db.insert_task("run-1", "main", "Hello").unwrap();
        let tasks = db.get_in_progress_tasks().unwrap();
        assert_eq!(tasks.len(), 1);
        assert_eq!(tasks[0].0, "run-1");

        // Test Update Status
        db.update_task_status("run-1", "running").unwrap();
        let tasks = db.get_in_progress_tasks().unwrap();
        assert_eq!(tasks.len(), 1);

        // Test Append Output
        db.append_task_output("run-1", "Hello ").unwrap();
        db.append_task_output("run-1", "World").unwrap();
        let output = db.get_task_output("run-1").unwrap();
        assert_eq!(output, "Hello World");

        // Test Complete
        db.update_task_status("run-1", "end").unwrap();
        let tasks = db.get_in_progress_tasks().unwrap();
        assert_eq!(tasks.len(), 0);

        let _ = fs::remove_file(&db_path);
    }
}
