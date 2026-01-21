// GeoFinder Background Service Worker
// Handles context menu and persistent analysis

// Shared config (inline since service workers can't import easily)
const Config = {
    defaultModel: 'gemini-2.5-flash',
    maxOutputTokens: 2048,
    temperature: 0.4,
    topK: 40,
    topP: 0.95,

    buildPrompt(context = '') {
        let prompt = `Analyze this image and identify the location.

Respond ONLY with this JSON (no markdown):
{
  "locations": [
    {
      "country": "Country name",
      "state": "Region or null",
      "city": "City or null",
      "confidence": "High/Medium/Low",
      "coordinates": {"latitude": 0.0, "longitude": 0.0},
      "reason": "1-2 sentences explaining key evidence"
    }
  ]
}`;
        if (context) prompt += `\nContext: ${context}`;
        return prompt;
    },

    parseResponse(rawText) {
        let jsonString = rawText.trim()
            .replace(/```json\s*/gi, '')
            .replace(/```\s*/g, '');

        const jsonMatch = jsonString.match(/\{[\s\S]*\}/);
        if (jsonMatch) jsonString = jsonMatch[0];

        let openBraces = (jsonString.match(/\{/g) || []).length;
        let closeBraces = (jsonString.match(/\}/g) || []).length;
        let openBrackets = (jsonString.match(/\[/g) || []).length;
        let closeBrackets = (jsonString.match(/\]/g) || []).length;

        while (openBrackets > closeBrackets) { jsonString += ']'; closeBrackets++; }
        while (openBraces > closeBraces) { jsonString += '}'; closeBraces++; }

        jsonString = jsonString.replace(/,\s*}/g, '}').replace(/,\s*]/g, ']');

        try {
            return JSON.parse(jsonString);
        } catch (e) {
            const countryMatch = rawText.match(/"country"\s*:\s*"([^"]+)"/);
            const reasonMatch = rawText.match(/"reason"\s*:\s*"([^"]+)"/);
            return {
                locations: [{
                    country: countryMatch ? countryMatch[1] : 'Unknown',
                    confidence: 'Low',
                    reason: reasonMatch ? reasonMatch[1] : 'Response parsing failed'
                }]
            };
        }
    }
};

// Create context menu on install
chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.create({
        id: 'geofinder-analyze',
        title: 'Analyze Location',
        contexts: ['image']
    });
});

// Handle context menu click
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId === 'geofinder-analyze' && info.srcUrl) {
        console.log('Context menu clicked for image:', info.srcUrl);

        // Get API key
        const storage = await chrome.storage.local.get(['geminiApiKey']);
        if (!storage.geminiApiKey) {
            // Notify user to set API key
            chrome.scripting.executeScript({
                target: { tabId: tab.id },
                func: () => alert('GeoFinder: Please set your API key in the extension popup first.')
            });
            return;
        }


        try {
            // Fetch and convert image to base64
            const response = await fetch(info.srcUrl);
            const blob = await response.blob();
            const base64 = await blobToBase64(blob);

            // Run analysis
            const result = await runAnalysis(base64, blob.type, '', storage.geminiApiKey, Config.defaultModel);

            // Show results in content script
            chrome.scripting.executeScript({
                target: { tabId: tab.id },
                func: showResultsOverlay,
                args: [result]
            });

        } catch (error) {
            console.error('Context menu analysis error:', error);
            chrome.scripting.executeScript({
                target: { tabId: tab.id },
                func: showErrorNotification,
                args: [error.message]
            });
        }
    }
});

// Handle messages from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'startAnalysis') {
        chrome.storage.local.set({ analysisInProgress: true, lastAnalysisResult: null });
        runAnalysis(message.imageBase64, message.mimeType, message.context, message.apiKey, message.model);
        sendResponse({ started: true });
    }
    return true;
});

async function blobToBase64(blob) {
    const buffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

async function runAnalysis(imageBase64, mimeType, context, apiKey, model) {
    console.log('Background: Starting analysis with model:', model);

    try {
        const requestBody = {
            contents: [{
                parts: [
                    { text: Config.buildPrompt(context) },
                    { inline_data: { mime_type: mimeType || "image/jpeg", data: imageBase64 } }
                ]
            }],
            generationConfig: {
                temperature: Config.temperature,
                topK: Config.topK,
                topP: Config.topP,
                maxOutputTokens: Config.maxOutputTokens
            }
        };

        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1/models/${model}:generateContent?key=${apiKey}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody)
            }
        );

        if (!response.ok) {
            const errorText = await response.text();
            console.error('Background API error:', response.status, errorText);

            if ((response.status === 429 || response.status === 503) && model !== 'gemini-2.5-flash-lite') {
                console.log('Trying fallback model...');
                return runAnalysis(imageBase64, mimeType, context, apiKey, 'gemini-2.5-flash-lite');
            }

            throw new Error(`API Error: ${response.status}`);
        }

        const data = await response.json();
        const rawText = data.candidates[0].content.parts[0].text;
        const result = Config.parseResponse(rawText);

        // Save result for popup
        chrome.storage.local.set({ analysisInProgress: false, lastAnalysisResult: result });
        console.log('Background: Analysis complete');

        return result;

    } catch (error) {
        console.error('Background analysis error:', error);
        const errorResult = { error: error.message };
        chrome.storage.local.set({ analysisInProgress: false, lastAnalysisResult: errorResult });
        throw error;
    }
}

// Escape HTML to prevent XSS attacks
function escapeHtml(text) {
    if (text == null) return '';
    const div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML;
}


function showErrorNotification(message) {
    function escapeHtml(text) {
        if (text == null) return '';
        const div = document.createElement('div');
        div.textContent = String(text);
        return div.innerHTML;
    }

    const existing = document.getElementById('geofinder-notification');
    if (existing) existing.remove();

    const escapedMessage = escapeHtml(message);
    const notification = document.createElement('div');
    notification.id = 'geofinder-notification';
    notification.innerHTML = `❌ Error: ${escapedMessage}`;
    notification.style.cssText = `
        position: fixed; top: 20px; right: 20px; z-index: 999999;
        background: #fecaca; color: #7f1d1d; padding: 14px 24px; border-radius: 12px;
        font-family: system-ui, -apple-system, sans-serif; font-weight: 500;
        font-size: 14px; box-shadow: 0 4px 16px rgba(254, 202, 202, 0.4);
    `;
    document.body.appendChild(notification);
    setTimeout(() => notification.remove(), 5000);
}

function showResultsOverlay(result) {
    // Inline escapeHtml for page context
    function escapeHtml(text) {
        if (text == null) return '';
        const div = document.createElement('div');
        div.textContent = String(text);
        return div.innerHTML;
    }

    const existing = document.getElementById('geofinder-notification');
    if (existing) existing.remove();

    const existingOverlay = document.getElementById('geofinder-overlay');
    if (existingOverlay) existingOverlay.remove();

    const overlay = document.createElement('div');
    overlay.id = 'geofinder-overlay';
    overlay.style.cssText = `
        position: fixed; top: 0; left: 0; width: 100%; height: 100%;
        background: rgba(0, 0, 0, 0.6); z-index: 999999;
        display: flex; align-items: center; justify-content: center;
        font-family: system-ui, -apple-system, sans-serif;
    `;

    let html = `
        <div style="background: #fefefe; border-radius: 16px; padding: 28px; max-width: 460px; max-height: 80vh; overflow-y: auto; box-shadow: 0 20px 40px rgba(0, 0, 0, 0.2);">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px;">
                <h2 style="margin: 0; color: #1f2937; font-size: 20px; font-weight: 600;">Results</h2>
                <button onclick="document.getElementById('geofinder-overlay').remove()" style="background: #f3f4f6; border: none; font-size: 20px; cursor: pointer; color: #6b7280; width: 36px; height: 36px; border-radius: 8px;">×</button>
            </div>
    `;

    if (result.error) {
        html += `<div style="color: #991b1b; padding: 16px; background: #fef2f2; border-radius: 12px;">Error: ${escapeHtml(result.error)}</div>`;
    } else if (result.locations && result.locations.length > 0) {
        result.locations.forEach((loc, i) => {
            const confColor = loc.confidence === 'High' ? '#bbf7d0' : loc.confidence === 'Medium' ? '#fef08a' : '#fecaca';
            const confTextColor = loc.confidence === 'High' ? '#166534' : loc.confidence === 'Medium' ? '#854d0e' : '#991b1b';
            const locationName = [escapeHtml(loc.city || ''), escapeHtml(loc.state || ''), escapeHtml(loc.country || '')].filter(Boolean).join(', ') || 'Unknown';
            const lat = typeof loc.coordinates?.latitude === 'number' ? loc.coordinates.latitude : 0;
            const lon = typeof loc.coordinates?.longitude === 'number' ? loc.coordinates.longitude : 0;
            const mapsUrl = loc.coordinates ? `https://www.google.com/maps?q=${lat},${lon}` : '';

            html += `
                <div style="background: #f9fafb; border-radius: 12px; padding: 16px; margin-bottom: 12px; border: 1px solid #e5e7eb;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                        <strong style="font-size: 16px; color: #1f2937;">${locationName}</strong>
                        <span style="background: ${confColor}; color: ${confTextColor}; padding: 4px 10px; border-radius: 20px; font-size: 11px; font-weight: 600;">${escapeHtml(loc.confidence || '')}</span>
                    </div>
                    ${loc.coordinates ? `<a href="${mapsUrl}" target="_blank" style="color: #6366f1; font-size: 13px; text-decoration: none;">📍 ${lat.toFixed(4)}, ${lon.toFixed(4)}</a>` : ''}
                    ${loc.reason ? `<p style="margin: 10px 0 0; font-size: 13px; color: #6b7280; line-height: 1.5;">${escapeHtml(loc.reason)}</p>` : ''}
                </div>
            `;
        });
    }

    html += '</div>';
    overlay.innerHTML = html;
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
}