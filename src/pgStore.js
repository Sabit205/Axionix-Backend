const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

let tableInitialized = false;

async function setupIndex() {
  const client = await pool.connect();
  try {
    // We create a robust table. We add an auto-generated tsvector column mapping title, description, and content.
    // 'english' dict ignores stop words and applies stemming.
    await client.query(`
      CREATE TABLE IF NOT EXISTS documents (
        id VARCHAR(255) PRIMARY KEY,
        url TEXT NOT NULL,
        domain VARCHAR(255) NOT NULL,
        title TEXT,
        description TEXT,
        content TEXT,
        keywords TEXT[],
        timestamp BIGINT,
        search_vector tsvector GENERATED ALWAYS AS (
          setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
          setweight(to_tsvector('english', coalesce(description, '')), 'B') ||
          setweight(to_tsvector('english', array_to_string(coalesce(keywords, ARRAY[]::TEXT[]), ' ')), 'B') ||
          setweight(to_tsvector('english', coalesce(content, '')), 'C')
        ) STORED
      );
    `);
    
    // Create an index on the search vector for ultra-fast full-text searches.
    await client.query(`
      CREATE INDEX IF NOT EXISTS search_vector_idx ON documents USING GIN (search_vector);
    `);
    
    tableInitialized = true;
    console.log('PostgreSQL index configured successfully.');
  } catch (error) {
    console.error('Failed to configure PostgreSQL index:', error.message);
  } finally {
    client.release();
  }
}

async function storeDocument(document) {
  if (!tableInitialized) {
    await setupIndex();
  }

  try {
    const { id, url, domain, title, description, content, keywords, timestamp } = document;
    
    // Upsert into postgres
    await pool.query(`
      INSERT INTO documents (id, url, domain, title, description, content, keywords, timestamp)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (id) DO UPDATE SET 
        title = EXCLUDED.title,
        description = EXCLUDED.description,
        content = EXCLUDED.content,
        keywords = EXCLUDED.keywords,
        timestamp = EXCLUDED.timestamp
    `, [id, url, domain, title, description, content, keywords, timestamp]);
    
  } catch (err) {
    console.error(`PostgreSQL insertion error for ${document.url}:`, err.message);
  }
}

module.exports = { storeDocument, pool };
