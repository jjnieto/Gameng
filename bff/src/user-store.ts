import type Database from "better-sqlite3";

export interface User {
  id: number;
  email: string;
  password_hash: string;
  actor_id: string;
  api_key: string;
  player_id: string;
  created_at: string;
  updated_at: string;
}

export interface UserPublic {
  id: number;
  email: string;
  actor_id: string;
  player_id: string;
  created_at: string;
}

export class UserStore {
  private stmtInsert;
  private stmtByEmail;
  private stmtById;
  private stmtApiKeyById;
  private stmtList;
  private stmtCount;

  constructor(private db: Database.Database) {
    this.stmtInsert = db.prepare(`
      INSERT INTO users (email, password_hash, actor_id, api_key, player_id)
      VALUES (@email, @passwordHash, @actorId, @apiKey, @playerId)
    `);
    this.stmtByEmail = db.prepare("SELECT * FROM users WHERE email = ?");
    this.stmtById = db.prepare("SELECT * FROM users WHERE id = ?");
    this.stmtApiKeyById = db.prepare("SELECT api_key FROM users WHERE id = ?");
    this.stmtList = db.prepare(
      "SELECT id, email, actor_id, player_id, created_at FROM users ORDER BY id LIMIT ? OFFSET ?",
    );
    this.stmtCount = db.prepare("SELECT COUNT(*) as count FROM users");
  }

  createUser(params: {
    email: string;
    passwordHash: string;
    actorId: string;
    apiKey: string;
    playerId: string;
  }): User {
    const result = this.stmtInsert.run(params);
    return this.stmtById.get(result.lastInsertRowid) as User;
  }

  findByEmail(email: string): User | undefined {
    return this.stmtByEmail.get(email) as User | undefined;
  }

  findById(id: number): User | undefined {
    return this.stmtById.get(id) as User | undefined;
  }

  getApiKeyById(id: number): string | undefined {
    const row = this.stmtApiKeyById.get(id) as
      | { api_key: string }
      | undefined;
    return row?.api_key;
  }

  list(limit: number = 50, offset: number = 0): UserPublic[] {
    return this.stmtList.all(limit, offset) as UserPublic[];
  }

  count(): number {
    const row = this.stmtCount.get() as { count: number };
    return row.count;
  }
}
