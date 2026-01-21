// Shared configuration for GeoFinder
// Changes here apply to both popup and context menu analysis

const GeoFinderConfig = {
    // API Settings
    defaultModel: 'gemini-2.5-flash',
    maxOutputTokens: 2048,
    temperature: 0.4,
    topK: 40,
    topP: 0.95,

    // Image Settings
    maxImageDimension: 1024,
    maxImageBytes: 10 * 1024 * 1024,

    // Build the analysis prompt
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

        if (context) {
            prompt += `\nContext: ${context}`;
        }
        return prompt;
    },

    // Parse API response
    parseResponse(rawText) {
        let jsonString = rawText.trim()
            .replace(/```json\s*/gi, '')
            .replace(/```\s*/g, '');

        const jsonMatch = jsonString.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            jsonString = jsonMatch[0];
        }

        // Fix incomplete JSON
        let openBraces = (jsonString.match(/\{/g) || []).length;
        let closeBraces = (jsonString.match(/\}/g) || []).length;
        let openBrackets = (jsonString.match(/\[/g) || []).length;
        let closeBrackets = (jsonString.match(/\]/g) || []).length;

        while (openBrackets > closeBrackets) { jsonString += ']'; closeBrackets++; }
        while (openBraces > closeBraces) { jsonString += '}'; closeBraces++; }

        jsonString = jsonString
            .replace(/,\s*}/g, '}')
            .replace(/,\s*]/g, ']');

        try {
            return JSON.parse(jsonString);
        } catch (e) {
            // Extract what we can
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

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
    module.exports = GeoFinderConfig;
}
