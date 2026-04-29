const { onRequest } = require("firebase-functions/v2/https");
const axios = require('axios');

exports.syncWealthboxProxy = onRequest({ cors: true, timeoutSeconds: 120 }, async (req, res) => {
    const apiKey = req.query.apiKey;
    if (!apiKey) return res.status(400).send('Missing API Key');

    try {
        let allTemplates = [];
        let page = 1;
        let hasMore = true;

        console.log("📡 Starting Multi-Page Sync...");

        while (hasMore) {
            const response = await axios.get(`https://api.crmworkspace.com/v1/workflow_templates?page=${page}`, {
                headers: { 
                    'ACCESS_TOKEN': apiKey,
                    'Accept': 'application/json'
                }
            });

            const templates = response.data.workflow_templates || [];
            allTemplates = allTemplates.concat(templates);

            // Wealthbox usually provides metadata about the next page
            // If we got 25, there's likely another page. If less, we are done.
            if (templates.length === 25) {
                page++;
            } else {
                hasMore = false;
            }
            
            // Safety brake: Don't loop more than 20 times (500 templates)
            if (page > 20) hasMore = false;
        }

        console.log(`✅ Total Templates Fetched: ${allTemplates.length}`);
        res.status(200).json({ workflow_templates: allTemplates });

    } catch (error) {
        console.error('Wealthbox Pagination Error:', error.message);
        res.status(500).send(error.message);
    }
});
