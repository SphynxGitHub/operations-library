const { onRequest } = require("firebase-functions/v2/https");
const functions = require("firebase-functions");
const axios = require('axios');

// Default options for v2 proxies
const proxyOptions = { cors: true, timeoutSeconds: 120 };

// 1. Wealthbox Proxy (v2)
exports.syncWealthboxProxy = onRequest(proxyOptions, async (req, res) => {
    const apiKey = req.query.apiKey;
    if (!apiKey) return res.status(400).send('Missing API Key');
    try {
        let allTemplates = [];
        let page = 1;
        let hasMore = true;
        while (hasMore) {
            const response = await axios.get(`https://api.crmworkspace.com/v1/workflow_templates?page=${page}`, {
                headers: { 'ACCESS_TOKEN': apiKey, 'Accept': 'application/json' }
            });
            const templates = response.data.workflow_templates || [];
            allTemplates = allTemplates.concat(templates);
            if (templates.length === 25 && page < 20) page++; else hasMore = false;
        }
        res.status(200).json({ workflow_templates: allTemplates });
    } catch (error) { 
        console.error("Wealthbox Error:", error.message);
        res.status(500).send(error.message); 
    }
});

// 2. Jotform Proxy (Updated with Multi-Page Pagination)
exports.jotformProxy = onRequest({ cors: true, timeoutSeconds: 120 }, async (req, res) => {
    const apiKey = req.query.apiKey;
    if (!apiKey) return res.status(400).send('Missing API Key');

    try {
        let allForms = [];
        let offset = 0;
        let hasMore = true;
        const limit = 50; // Fetch 50 at a time (Jotform's max per page is usually 100)

        console.log("📡 Jotform: Starting multi-page sync...");

        while (hasMore) {
            const response = await axios.get(`https://api.jotform.com/user/forms`, {
                params: { 
                    apiKey: apiKey,
                    offset: offset,
                    limit: limit,
                    orderby: 'id'
                }
            });

            const content = response.data.content || [];
            allForms = allForms.concat(content);

            // Jotform result set meta-data tells us if there are more
            // If we fetched fewer than the limit, we've reached the end
            if (content.length === limit) {
                offset += limit;
            } else {
                hasMore = false;
            }

            // Safety brake: stop after 10 pages (500 forms)
            if (offset >= 500) hasMore = false;
        }

        console.log(`✅ Jotform: Total forms fetched: ${allForms.length}`);
        
        // Return the same structure so app.js doesn't break
        res.status(200).json({ content: allForms });

    } catch (error) { 
        console.error("Jotform Pagination Error:", error.message);
        res.status(500).send(error.message); 
    }
});

// 3. Calendly Proxy (v1 Pattern for specific URL requirement)
exports.calendlyProxy = functions.https.onRequest(async (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        res.status(204).send('');
        return;
    }

    const apiKey = req.query.apiKey;
    if (!apiKey) return res.status(400).send('Missing API Key');

    try {
        const response = await axios.get("https://api.calendly.com/event_types?user=me", {
            headers: { 
                'Authorization': `Bearer ${apiKey}`,
                'Accept': 'application/json'
            }
        });
        res.status(200).json(response.data);
    } catch (error) {
        console.error("Calendly Error:", error.message);
        res.status(500).send(error.message);
    }
});

// 4. ActiveCampaign Proxy (v2)
exports.acProxy = onRequest(proxyOptions, async (req, res) => {
    const { apiKey, baseUrl } = req.query;
    if (!apiKey || !baseUrl) return res.status(400).send('Missing API Key or Base URL');
    try {
        const response = await axios.get(`${baseUrl}/api/3/automations`, {
            headers: { 'Api-Token': apiKey }
        });
        res.status(200).json(response.data);
    } catch (error) { res.status(500).send(error.message); }
});

// 5. MailerLite Proxy (v2)
exports.mailerliteProxy = onRequest(proxyOptions, async (req, res) => {
    const apiKey = req.query.apiKey;
    if (!apiKey) return res.status(400).send('Missing API Key');
    try {
        const response = await axios.get("https://connect.mailerlite.com/api/automations", {
            headers: { 'Authorization': `Bearer ${apiKey}` }
        });
        res.status(200).json(response.data);
    } catch (error) { res.status(500).send(error.message); }
});

// 6. YouCanBookMe Proxy (v2)
exports.ycbmProxy = onRequest(proxyOptions, async (req, res) => {
    const apiKey = req.query.apiKey; // This is the Base64 string from your app
    if (!apiKey) return res.status(400).send('Missing API Key');

    try {
        const response = await axios.get("https://api.youcanbook.me/v1/profiles", {
            headers: { 
                // 🚀 THE FIX: Pass the key as a Basic Auth header
                'Authorization': `Basic ${apiKey}`,
                'Accept': 'application/json'
            }
        });
        res.status(200).json(response.data);
    } catch (error) {
        // Log the specific error from YCBM so you can see it in Firebase Logs
        console.error("YCBM API Error:", error.response?.data || error.message);
        res.status(500).send(error.message);
    }
});
