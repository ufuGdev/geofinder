// Background service worker for GeoFinder extension

// Handle extension installation
chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install') {
        // First time installation
        console.log('GeoFinder extension installed successfully!');
        
        // Open welcome page or show instructions
        chrome.tabs.create({
            url: 'https://ai.google.dev/'
        });
    }
});

// Handle extension icon click
chrome.action.onClicked.addListener((tab) => {
    // This will open the popup defined in manifest.json
    console.log('GeoFinder extension clicked');
});

// Handle messages from content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'getApiKey') {
        // Return API key to content script
        chrome.storage.sync.get(['geminiApiKey'], (result) => {
            sendResponse({ apiKey: result.geminiApiKey || '' });
        });
        return true; // Keep message channel open for async response
    }
    
    if (message.action === 'analyzeImage') {
        // Handle image analysis request from content script
        handleImageAnalysis(message.imageData, message.context)
            .then(result => {
                sendResponse({ success: true, result });
            })
            .catch(error => {
                sendResponse({ success: false, error: error.message });
            });
        return true; // Keep message channel open for async response
    }
});

// Handle image analysis in background
async function handleImageAnalysis(imageBase64, context) {
    try {
        // Get API key from storage
        const result = await chrome.storage.sync.get(['geminiApiKey']);
        const apiKey = result.geminiApiKey;
        
        if (!apiKey) {
            throw new Error('API key not found. Please set your Gemini API key in the extension popup.');
        }

        // Call Gemini API
        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1/models/gemini-2.0-flash-lite-001:generateContent?key=${apiKey}`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    contents: [{
                        parts: [
                            { text: buildPrompt(context) },
                            {
                                inline_data: {
                                    mime_type: "image/jpeg",
                                    data: imageBase64
                                }
                            }
                        ]
                    }],
                    generationConfig: {
                        temperature: 0.4,
                        topK: 32,
                        topP: 1,
                        maxOutputTokens: 2048
                    }
                })
            }
        );

        if (!response.ok) {
            throw new Error(`API request failed: ${response.status}`);
        }

        const data = await response.json();
        const rawText = data.candidates[0].content.parts[0].text;
        console.log('Raw API response (background):', rawText);
        
        // Clean up the response
        let jsonString = rawText.trim();
        
        // Remove markdown code blocks if present
        jsonString = jsonString.replace(/```json\s*/g, '').replace(/```\s*/g, '');
        
        // Try to find JSON object in the response
        const jsonMatch = jsonString.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            jsonString = jsonMatch[0];
        }
        
        console.log('Cleaned response for parsing (background):', jsonString);
        
        try {
            return JSON.parse(jsonString);
        } catch (e) {
            console.error('Failed to parse API response (background):', e);
            console.error('Raw response was:', rawText);
            
            // Try to extract any useful information from the response
            if (rawText.includes('error') || rawText.includes('Error')) {
                throw new Error(`API Error: ${rawText}`);
            } else {
                throw new Error('API returned invalid JSON format. Please try again.');
            }
        }
    } catch (error) {
        console.error('Background analysis error:', error);
        throw error;
    }
}

function buildPrompt(context) {
    let prompt = `You are a professional geolocation expert. You MUST respond with a valid JSON object in the following format:

{
  "interpretation": "A comprehensive analysis of the image, including:
    - Architectural style and period
    - Notable landmarks or distinctive features
    - Natural environment and climate indicators
    - Cultural elements (signage, vehicles, clothing, etc.)
    - Any visible text or language
    - Time period indicators (if any)",
  "locations": [
    {
      "country": "Primary country name",
      "state": "State/region/province name",
      "city": "City name",
      "confidence": "High/Medium/Low",
      "coordinates": {
        "latitude": 12.3456,
        "longitude": 78.9012
      },
      "explanation": "Detailed reasoning for this location identification, including:
        - Specific architectural features that match this location
        - Environmental characteristics that support this location
        - Cultural elements that indicate this region
        - Any distinctive landmarks or features
        - Supporting evidence from visible text or signage"
    }
  ]
}

CRITICAL REQUIREMENTS: 
1. Your response MUST be ONLY a valid JSON object - nothing else.
2. Do not include any text before or after the JSON object.
3. Do not use markdown formatting, code blocks, or any other formatting.
4. Do not include explanations, notes, or any text outside the JSON structure.
5. The response must be directly parseable by JSON.parse() without any preprocessing.
6. You can provide up to three possible locations if you are not completely confident about a single location.
7. Order the locations by confidence level (highest to lowest).
8. ALWAYS include approximate coordinates (latitude and longitude) for each location when possible.

Consider these key aspects for accurate location identification:
1. Architectural Analysis:
   - Building styles and materials
   - Roof types and construction methods
   - Window and door designs
   - Decorative elements and ornamentation

2. Environmental Indicators:
   - Vegetation types and patterns
   - Climate indicators (snow, desert, tropical, etc.)
   - Terrain and topography
   - Water bodies or coastal features

3. Cultural Context:
   - Language of visible text
   - Vehicle types and styles
   - Clothing and fashion
   - Street furniture and infrastructure
   - Commercial signage and branding

4. Time Period Indicators:
   - Architectural period
   - Vehicle models
   - Fashion styles
   - Technology visible`;

    if (context) {
        prompt += `\n\nAdditional context provided by the user:\n${context}`;
    }

    prompt += '\n\nCRITICAL: Your response must be ONLY a valid JSON object. Do not include any text before or after the JSON. Do not use markdown formatting. Do not include explanations outside the JSON. The response must be parseable by JSON.parse().';
    
    return prompt;
}

// Handle storage changes
chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'sync' && changes.geminiApiKey) {
        console.log('API key updated:', changes.geminiApiKey.newValue ? 'Set' : 'Removed');
    }
});

// Handle tab updates to inject content script if needed
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' && tab.url && tab.url.startsWith('http')) {
        // Content script is automatically injected via manifest.json
        console.log('Tab updated, content script should be active');
    }
}); 