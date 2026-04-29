const functions = require('firebase-functions');
const axios = require('axios');
const cors = require('cors')({origin: true});

exports.syncWealthboxProxy = functions.https.onRequest((req, res) => {
    return cors(req, res, async () => {
        const apiKey = req.query.apiKey;
        if (!apiKey) return res.status(400).send('Missing API Key');

        try {
            // This is the server talking to Wealthbox
            const response = await axios.get('https://api.crmworkspace.com/v1/workflow_templates', {
                headers: { 'ACCESS_TOKEN': apiKey }
            });
            // Sending the data back to your app
            res.status(200).json(response.data);
        } catch (error) {
            console.error('Wealthbox Error:', error.message);
            res.status(500).send(error.message);
        }
    });
});
