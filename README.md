1) package.json
{
  "name": "bu-result-finder",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "client": "cd client && npm run start",
    "build": "cd client && npm run build",
    "start": "node server.js"
  },
  "dependencies": {
    "axios": "^1.4.0",
    "cheerio": "^1.0.0-rc.12",
    "express": "^4.18.2",
    "express-rate-limit": "^6.7.0",
    "helmet": "^7.0.0",
    "cors": "^2.8.5",
    "lru-cache": "^10.0.0"
  }
}

2) server.js
const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const cors = require('cors');
const path = require('path');
const LRU = require('lru-cache');

const app = express();
app.use(helmet());
app.use(express.json());
app.use(cors({ origin: '*' }));

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { error: 'Too many requests, slow down.' }
});
app.use(limiter);

// Simple in-memory cache to avoid hammering target site
const cache = new LRU({ max: 500, ttl: 1000 * 60 * 5 }); // 5 minutes

// Generic fetch + find endpoint
app.post('/api/result', async (req, res) => {
  try {
    const { roll } = req.body;
    if (!roll || typeof roll !== 'string') return res.status(400).json({ error: 'Missing roll' });
    const cacheKey = `roll:${roll}`;

    if (cache.has(cacheKey)) {
      return res.json({ roll, parsed: cache.get(cacheKey), cached: true });
    }

    // ---------- UPDATE THIS if you have a more specific URL ----------
    // Using bubhopalnic.in placeholder search page which is public (example). [bubhopalnic](https://bubhopalnic.in/eng.php)
    const targetUrl = 'https://bubhopalnic.in/eng.php';

    // Fetch page (use GET). If real page needs POST/form, adapt here (do not include credentials).
    const r = await axios.get(targetUrl, {
      timeout: 10000,
      headers: { 'User-Agent': 'BU-Result-Finder/1.0 (+contact@yourdomain.com)' }
    });

    const $ = cheerio.load(r.data);

    // Generic parsing strategy:
    // 1) search for any table/div/p that contains the roll text
    // 2) for tables: convert the surrounding table to structured rows
    // 3) otherwise return the element text as fallback
    let parsed = null;

    // Search tables first
    $('table').each((i, table) => {
      const tableText = $(table).text();
      if (tableText && tableText.includes(roll)) {
        // parse rows
        const rows = [];
        $(table).find('tr').each((ri, tr) => {
          const cells = $(tr).find('th,td').map((ci, cell) => $(cell).text().trim()).get();
          if (cells.length) rows.push(cells);
        });
        parsed = { type: 'table', rows };
        return false;
      }
    });

    // Search other blocks if not found in tables
    if (!parsed) {
      $('div, p, section').each((i, el) => {
        const text = $(el).text();
        if (text && text.includes(roll)) {
          parsed = { type: 'block', html: $(el).html(), text: text.trim().slice(0, 4000) };
          return false;
        }
      });
    }

    if (!parsed) {
      // last-resort: do a fuzzy search in whole page and return surrounding text
      const bodyText = $('body').text();
      const idx = bodyText.indexOf(roll);
      if (idx >= 0) {
        const snippet = bodyText.slice(Math.max(0, idx - 200), Math.min(bodyText.length, idx + 400));
        parsed = { type: 'snippet', snippet };
      }
    }

    if (!parsed) return res.status(404).json({ error: 'Result not found on fetched public page' });

    cache.set(cacheKey, parsed);
    res.json({ roll, parsed, cached: false });
  } catch (err) {
    console.error(err && err.message ? err.message : err);
    res.status(500).json({ error: 'Failed to fetch public result' });
  }
});

// Serve client build
app.use(express.static(path.join(__dirname, 'client', 'build')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'client', 'build', 'index.html'));
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Server listening on ${PORT}`));

3) client/index.html
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>BU Result Finder</title>
  </head>
  <body>
    <div id="root"></div>
    <script src="bundle.js"></script>
  </body>
</html>

4) client/src/index.jsx
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

const root = createRoot(document.getElementById('root'));
root.render(<App />);

5) client/src/App.jsx
import React, { useState } from 'react';
import axios from 'axios';

export default function App(){
  const [roll, setRoll] = useState('');
  const [loading, setLoading] = useState(false);
  const [parsed, setParsed] = useState(null);
  const [error, setError] = useState(null);

  const fetchResult = async () => {
    setLoading(true); setError(null); setParsed(null);
    try {
      const r = await axios.post('/api/result', { roll });
      setParsed(r.data);
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally { setLoading(false); }
  };

  return (
    <div className="container">
      <h1>BU Result Finder</h1>
      <p>Enter roll/enrollment number to fetch publicly available result text (no login).</p>
      <div style={{marginBottom:12}}>
        <input value={roll} onChange={e=>setRoll(e.target.value)} placeholder="Enter roll/enrollment" />
        <button onClick={fetchResult} disabled={!roll || loading} style={{marginLeft:8}}>
          {loading ? 'Searching...' : 'Search'}
        </button>
      </div>

      {error && <div className="error">{error}</div>}

      {parsed && (
        <div className="result">
          <div><strong>Roll:</strong> {parsed.roll}</div>
          <div><strong>Cached:</strong> {String(parsed.cached)}</div>

          {parsed.parsed.type === 'table' && (
            <table className="outtable">
              <tbody>
                {parsed.parsed.rows.map((row, i) => (
                  <tr key={i}>
                    {row.map((cell, j) => <td key={j}>{cell}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {parsed.parsed.type === 'block' && (
            <div dangerouslySetInnerHTML={{ __html: parsed.parsed.html }} />
          )}

          {parsed.parsed.type === 'snippet' && (
            <pre>{parsed.parsed.snippet}</pre>
          )}
        </div>
      )}
    </div>
  );
}

6) client/src/styles.css
body{font-family:Arial,Helvetica,sans-serif;background:#f7f7f9;padding:24px}
.container{max-width:720px;margin:0 auto;background:#fff;padding:20px;border-radius:6px;box-shadow:0 2px 6px rgba(0,0,0,0.08)}
input{width:60%;padding:8px;margin-right:8px}
button{padding:8px 12px}
.result{margin-top:16px;padding:12px;background:#f1f1f1;border-radius:4px}
.error{color:#900;margin-top:12px}
.outtable{width:100%;border-collapse:collapse}
.outtable td{border:1px solid #ddd;padding:6px}

7) client/package.json
{
  "name": "client",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "start": "webpack serve --mode development --open",
    "build": "webpack --mode production"
  },
  "dependencies": {
    "axios": "^1.4.0",
    "react": "^18.2.0",
    "react-dom": "^18.2.0"
  },
  "devDependencies": {
    "@babel/core": "^7.22.0",
    "@babel/preset-env": "^7.22.0",
    "@babel/preset-react": "^7.18.6",
    "babel-loader": "^9.1.2",
    "css-loader": "^6.8.1",
    "html-webpack-plugin": "^5.5.1",
    "style-loader": "^3.3.2",
    "webpack": "^5.88.2",
    "webpack-cli": "^5.1.4",
    "webpack-dev-server": "^4.15.1"
  }
}

8) client/webpack.config.js
const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');

module.exports = {
  entry: path.resolve(__dirname, 'src', 'index.jsx'),
  output: {
    path: path.resolve(__dirname, 'build'),
    filename: 'bundle.js',
    publicPath: '/'
  },
  resolve: { extensions: ['.js', '.jsx'] },
  module: {
    rules: [
      { test: /\.(js|jsx)$/, exclude: /node_modules/, use: 'babel-loader' },
      { test: /\.css$/, use: ['style-loader','css-loader'] }
    ]
  },
  plugins: [
    new HtmlWebpackPlugin({ template: path.resolve(__dirname, 'index.html') })
  ],
  devServer: {
    historyApiFallback: true,
    static: path.resolve(__dirname, 'build'),
    port: 3000,
    proxy: { '/api': 'http://localhost:4000' }
  }
};

9) client/.babelrc
{
  "presets": ["@babel/preset-env", "@babel/preset-react"]
}

10) README (quick run)
1. Create a project folder and paste files with the structure:
   - package.json
   - server.js
   - client/
     - index.html
     - package.json
     - webpack.config.js
     - .babelrc
     - src/
       - index.jsx
       - App.jsx
       - styles.css
2. From root: npm install
3. Client: cd client && npm install
4. Build client: npm run build
5. Back to root: cd .. then node server.js
6. Open http://localhost:4000 and test.