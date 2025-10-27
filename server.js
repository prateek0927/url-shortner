const express = require("express");
const crypto = require("crypto");

//Server
const app = express();
app.use(express.json());

// Serve static files
app.use(express.static("public"));


//trying this out in class constructor pattern to test my OOP basics
class URLShortener {
  constructor() {
    // Main storage 
    this.urlMap = new Map();
    this.longToShort = new Map(); 

    this.ttlQueue = [];

    // Constants
    this.DEFAULT_TTL = 120; 
    this.BASE_URL = "http://localhost:3000";
    this.ALIAS_LENGTH = 6;
    this.MAX_ACCESS_TIMES = 10;

    // Start TTL cleanup
    this.startTTLCleanup();
  }

  // Generate random alias
  generateRandomAlias() {
    // check this out after the implementation
    const chars =
      "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let alias = "";

    // Generate alias of ALIAS_LENGTH
    for (let i = 0; i < this.ALIAS_LENGTH; i++) {
      alias += chars[Math.floor(Math.random() * chars.length)];
    }

    return alias;
  }

  // Create shortened URL
  createShortUrl(longUrl, customAlias = null, ttlSeconds = null) {
    const ttl = ttlSeconds || this.DEFAULT_TTL;
    let alias = customAlias;

    // Generate random alias if not provided
    if (!alias) {
      // Generate new unique alias each time even for same URL - question condition
      do {
        alias = this.generateRandomAlias();
      } while (this.urlMap.has(alias));
    } else {
      // if custom alias already exists
      if (this.urlMap.has(alias)) {
        throw new Error("Custom alias already exists");
      }
    }

    const now = Date.now();
    const expirationTime = now + ttl * 1000;

    this.urlMap.set(alias, {
      longUrl: longUrl,
      ttl: ttl,
      createdAt: now,
      expirationTime: expirationTime,
      accessCount: 0,
      accessTimes: [],
    });

    if (!this.longToShort.has(longUrl)) {
      this.longToShort.set(longUrl, new Set());
    }
    this.longToShort.get(longUrl).add(alias);

    this.addToTtl(alias, expirationTime);

    return `${this.BASE_URL}/${alias}`;
  }

  // Get original URL and track access
  getLongUrl(alias) {
    const data = this.urlMap.get(alias);

    if (!data) {
      return null;
    }

    // expired check
    if (Date.now() > data.expirationTime) {
      this.deleteUrl(alias);
      return null;
    }

    // Update analytics
    data.accessCount++;
    const accessTime = new Date().toISOString();

    //queue of last 10 access times and removing any old access which we might get after 10 access
    if (data.accessTimes.length >= this.MAX_ACCESS_TIMES) {
      data.accessTimes.shift();
    }
    data.accessTimes.push(accessTime);

    return data.longUrl;
  }

  // Get analytics
  getAnalytics(alias) {
    const data = this.urlMap.get(alias);

    if (!data) {
      return null;
    }

    // Check if expired
    if (Date.now() > data.expirationTime) {
      this.deleteUrl(alias);
      return null;
    }

    return {
      alias: alias,
      long_url: data.longUrl,
      access_count: data.accessCount,
      access_times: [...data.accessTimes],
    };
  }

  // Update URL - question condition
  updateUrl(oldAlias, newCustomAlias = null, newTtlSeconds = null) {
    const data = this.urlMap.get(oldAlias);

    if (!data) {
      return false;
    }

    // Check if expired
    if (Date.now() > data.expirationTime) {
      this.deleteUrl(oldAlias);
      return false;
    }

    // If custom alias is being updated
    if (newCustomAlias && newCustomAlias !== oldAlias) {
      // check new alias already exists
      if (this.urlMap.has(newCustomAlias)) {
        throw new Error("New custom alias already exists");
      }

      // Create new entry with new ttl and new access count
      const now = Date.now();
      const ttl = newTtlSeconds || data.ttl;
      const expirationTime = now + ttl * 1000;

      this.urlMap.set(newCustomAlias, {
        longUrl: data.longUrl,
        ttl: ttl,
        createdAt: now,
        expirationTime: expirationTime,
        accessCount: 0, 
        accessTimes: [],
      });

      // Update long URL mapping
      const aliases = this.longToShort.get(data.longUrl);
      if (aliases) {
        aliases.delete(oldAlias);
        aliases.add(newCustomAlias);
      }

      // add new alias to ttl queue
      this.addToTtl(newCustomAlias, expirationTime);

      // dlete old alias
      this.urlMap.delete(oldAlias);

      return true;
    }

    // If only ttl is being updated
    if (newTtlSeconds) {
      const now = Date.now();
      data.ttl = newTtlSeconds;
      data.expirationTime = now + newTtlSeconds * 1000;
      this.addToTtl(oldAlias, data.expirationTime);
    }

    return true;
  }

  // Delete URL
  deleteUrl(alias) {
    const data = this.urlMap.get(alias);

    if (!data) {
      return false;
    }
    const aliases = this.longToShort.get(data.longUrl);
    if (aliases) {
      aliases.delete(alias);
      if (aliases.size === 0) {
        this.longToShort.delete(data.longUrl);
      }
    }
    this.urlMap.delete(alias);
    this.removeFromTtl(alias);

    return true;
  }

  removeFromTtl(alias) {
    this.ttlQueue = this.ttlQueue.filter((entry) => entry.alias !== alias);
  }

  addToTtl(alias, expirationTime) {
    // First trying to remove any existing entries for this alias to prevent duplicatio
    this.removeFromTtl(alias);

    // Here using simple array with binary search insertion, could use priority queue
    const entry = { alias, expirationTime };

    // Binary search to find insertion point
    let left = 0;
    let right = this.ttlQueue.length;

    while (left < right) {
      const mid = Math.floor((left + right) / 2);
      if (this.ttlQueue[mid].expirationTime <= expirationTime) {
        left = mid + 1;
      } else {
        right = mid;
      }
    }

    this.ttlQueue.splice(left, 0, entry);
  }

  // ttl cleanup job
  startTTLCleanup() {
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();

      // Remove expired entries from front of queue
      while (
        this.ttlQueue.length > 0 &&
        this.ttlQueue[0].expirationTime <= now
      ) {
        const { alias } = this.ttlQueue.shift();

        // Check if still exists and is expired
        const data = this.urlMap.get(alias);
        if (data && data.expirationTime <= now) {
          this.deleteUrl(alias);
        }
      }
    }, 1000);//come back to this
  }

  // Cleanup resources
  shutdown() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.urlMap.clear();
    this.longToShort.clear();
    this.ttlQueue = [];
  }
}

const urlShortener = new URLShortener();

// 1. POST /shorten - Create shortURL
app.post("/shorten", (req, res) => {
  try {
    const { long_url, custom_alias, ttl_seconds } = req.body;

    if (!long_url) {
      return res.status(400).json({ error: "long_url is required" });
    }

    const shortUrl = urlShortener.createShortUrl(
      long_url,
      custom_alias,
      ttl_seconds
    );

    res.json({ short_url: shortUrl });
  } catch (error) {
    if (error.message === "Custom alias already exists") {
      return res.status(400).json({ error: error.message });
    }
    res.status(500).json({ error: "Internal server error" });
  }
});

// 3. GET /analytics/:alias - Get URL analytics
app.get("/analytics/:alias", (req, res) => {
  try {
    const { alias } = req.params;

    const analytics = urlShortener.getAnalytics(alias);

    if (!analytics) {
      return res
        .status(404)
        .json({ error: "Alias does not exist or might be expired" });
    }

    res.json(analytics);
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// 6. GET /list - List all active URL
app.get("/list", (req, res) => {
  try {
    const now = Date.now();
    const activeUrls = [];

    // Get all active URLs
    urlShortener.urlMap.forEach((data, alias) => {
      // Filter out expired URLs
      if (data.expirationTime > now) {
        activeUrls.push({
          alias: alias,
          long_url: data.longUrl,
          access_count: data.accessCount,
          access_times: data.accessTimes,
          ttl: data.ttl,
          created_at: new Date(data.createdAt).toISOString(),
          expires_at: new Date(data.expirationTime).toISOString(),
          time_remaining: Math.floor((data.expirationTime - now) / 1000),
        });
      }
    });

    res.json({
      total: activeUrls.length,
      urls: activeUrls,
      ttl_queue_size: urlShortener.ttlQueue.length,
    });
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// 2. GET /:alias - to redirect to long URL
app.get("/:alias", (req, res) => {
  try {
    const { alias } = req.params;

    const longUrl = urlShortener.getLongUrl(alias);

    if (!longUrl) {
      return res
        .status(404)
        .json({ error: "Alias does not exist or has expired" });
    }

    // 302 Temporary Redirect
    res.redirect(302, longUrl);
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// 4. PUT /update/:alias - Update URL
app.put("/update/:alias", (req, res) => {
  try {
    const { alias } = req.params;
    const { custom_alias, ttl_seconds } = req.body;

    const success = urlShortener.updateUrl(alias, custom_alias, ttl_seconds);

    if (!success) {
      return res
        .status(404)
        .json({ error: "Alias does not exist or has expired" });
    }

    res.status(200).json({ message: "Successfully updated" });
  } catch (error) {
    if (error.message === "New custom alias already exists") {
      return res.status(400).json({ error: error.message });
    }
    res.status(500).json({ error: "Internal server error" });
  }
});

// 5. DELETE /delete/:alias - Delete URL
app.delete("/delete/:alias", (req, res) => {
  try {
    const { alias } = req.params;

    const success = urlShortener.deleteUrl(alias);

    if (!success) {
      return res
        .status(404)
        .json({ error: "Alias does not exist or has expired" });
    }

    res.status(200).json({ message: "Successfully deleted" });
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});


// Start server
const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
  console.log(`\nURL Shortener Server running on port ${PORT}`);
  console.log(`\nDashboard: http://localhost:${PORT}/dashboard.html`);
  console.log(`Base URL: http://localhost:${PORT}`);
});

module.exports = { URLShortener, app };
