class GeoFinderContent {
    constructor() {
        this.apiKey = '';
        this.selectedImage = null;
        this.overlay = null;
        this.init();
    }

    init() {
        this.loadApiKey();
        this.addGuessButtons();
    }

    loadApiKey() {
        chrome.storage.sync.get(['geminiApiKey'], (result) => {
            if (result.geminiApiKey) {
                this.apiKey = result.geminiApiKey;
            }
        });
    }



    addGuessButtons() {
        // Add guess buttons to images on the page
        const images = document.querySelectorAll('img');
        images.forEach(img => {
            if (img.width > 100 && img.height > 100) { // Only add to reasonably sized images
                this.addGuessButtonToImage(img);
            }
        });

        // Watch for dynamically added images
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                mutation.addedNodes.forEach((node) => {
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        if (node.tagName === 'IMG') {
                            if (node.width > 100 && node.height > 100) {
                                this.addGuessButtonToImage(node);
                            }
                        } else {
                            const images = node.querySelectorAll('img');
                            images.forEach(img => {
                                if (img.width > 100 && img.height > 100) {
                                    this.addGuessButtonToImage(img);
                                }
                            });
                        }
                    }
                });
            });
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    }

    addGuessButtonToImage(img) {
        // Check if button already exists
        if (img.nextElementSibling && img.nextElementSibling.classList.contains('geofinder-guess-btn')) {
            return;
        }

        // Create guess button
        const guessBtn = document.createElement('button');
        guessBtn.className = 'geofinder-guess-btn';
        guessBtn.innerHTML = '🌍 Guess';
        guessBtn.title = 'Click to analyze this image location';
        
        // Style the button
        guessBtn.style.cssText = `
            position: absolute;
            top: 7px;
            right: 7px;
            background: rgba(90, 111, 204, 0.9);
            color: white;
            border: none;
            padding: 8px 12px;
            border-radius: 6px;
            font-size: 10px;
            cursor: pointer;
            z-index: 10000;
            opacity: 0;
            transition: opacity 0.3s ease;
            backdrop-filter: blur(4px);
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        `;

        // Create wrapper for image and button
        const wrapper = document.createElement('div');
        wrapper.style.cssText = `
            position: relative;
            display: inline-block;
        `;

        // Insert wrapper before image
        img.parentNode.insertBefore(wrapper, img);
        wrapper.appendChild(img);
        wrapper.appendChild(guessBtn);

        // Show button on hover
        wrapper.addEventListener('mouseenter', () => {
            guessBtn.style.opacity = '1';
        });

        wrapper.addEventListener('mouseleave', () => {
            guessBtn.style.opacity = '0';
        });

        // Handle click
        guessBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.analyzeImage(img.src);
        });
    }



    async analyzeImage(imageSrc) {
        if (!this.apiKey) {
            this.showNotification('Please set your Gemini API key in the extension popup first.', 'error');
            return;
        }

        this.showNotification('Analyzing image...', 'info');

        try {
            // Convert image to base64
            const base64 = await this.imageToBase64(imageSrc);
            
            // Call Gemini API
            const result = await this.callGeminiAPI(base64);
            
            // Display results
            this.showResults(result);
        } catch (error) {
            console.error('Analysis error:', error);
            this.showNotification('Failed to analyze image. Please check your API key.', 'error');
        }
    }

    async imageToBase64(imageSrc) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                
                canvas.width = img.width;
                canvas.height = img.height;
                
                ctx.drawImage(img, 0, 0);
                
                try {
                    const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
                    const base64 = dataUrl.split(',')[1];
                    resolve(base64);
                } catch (e) {
                    reject(new Error('Failed to convert image to base64'));
                }
            };
            
            img.onerror = () => {
                reject(new Error('Failed to load image'));
            };
            
            img.src = imageSrc;
        });
    }

    async callGeminiAPI(imageBase64) {
        const prompt = this.buildPrompt();
        
        const requestBody = {
            contents: [{
                parts: [
                    { text: prompt },
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
        };

        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1/models/gemini-2.0-flash-lite-001:generateContent?key=${this.apiKey}`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(requestBody)
            }
        );

        if (!response.ok) {
            throw new Error(`API request failed: ${response.status}`);
        }

        const data = await response.json();
        const rawText = data.candidates[0].content.parts[0].text;
        
        // Clean up the response
        const jsonString = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
        
        try {
            return JSON.parse(jsonString);
        } catch (e) {
            throw new Error('Failed to parse API response');
        }
    }

    buildPrompt() {
        return `You are a professional geolocation expert. You MUST respond with a valid JSON object in the following format:

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

IMPORTANT: 
1. Your response MUST be a valid JSON object. Do not include any text before or after the JSON object.
2. Do not include any markdown formatting or code blocks.
3. The response should be parseable by JSON.parse().
4. You can provide up to three possible locations if you are not completely confident about a single location.
5. Order the locations by confidence level (highest to lowest).
6. ALWAYS include approximate coordinates (latitude and longitude) for each location when possible.

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
   - Technology visible

Remember: Your response must be a valid JSON object only. No additional text or formatting.`;
    }

    showResults(result) {
        if (result.error) {
            this.showNotification(`Error: ${result.error}`, 'error');
            return;
        }

        // Create overlay for results
        this.createResultsOverlay(result);
    }

    createResultsOverlay(result) {
        // Remove existing overlay
        if (this.overlay) {
            document.body.removeChild(this.overlay);
        }

        // Create new overlay
        this.overlay = document.createElement('div');
        this.overlay.className = 'geofinder-overlay';
        this.overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.8);
            z-index: 100000;
            display: flex;
            align-items: center;
            justify-content: center;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        `;

        // Create results container
        const resultsContainer = document.createElement('div');
        resultsContainer.style.cssText = `
            background: white;
            border-radius: 12px;
            padding: 24px;
            max-width: 500px;
            max-height: 80vh;
            overflow-y: auto;
            box-shadow: 0 20px 40px rgba(0, 0, 0, 0.3);
        `;

        let html = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
                <h2 style="margin: 0; color: #495057;">🌍 Location Analysis Results</h2>
                <button id="closeOverlay" style="background: none; border: none; font-size: 24px; cursor: pointer; color: #6c757d;">×</button>
            </div>
        `;

        // Display interpretation
        if (result.interpretation) {
            html += `
                <div style="background: #e3f2fd; border-radius: 8px; padding: 15px; margin-bottom: 15px; border-left: 4px solid #2196f3;">
                    <h4 style="color: #1976d2; margin: 0 0 8px 0; font-size: 14px;">Image Analysis</h4>
                    <p style="font-size: 14px; color: #424242; line-height: 1.5; margin: 0;">${result.interpretation}</p>
                </div>
            `;
        }

        // Display locations
        if (result.locations && result.locations.length > 0) {
            result.locations.forEach((location, index) => {
                const confidenceColor = location.confidence === 'High' ? '#d4edda' : 
                                      location.confidence === 'Medium' ? '#fff3cd' : '#f8d7da';
                const confidenceTextColor = location.confidence === 'High' ? '#155724' : 
                                          location.confidence === 'Medium' ? '#856404' : '#721c24';
                const mapsUrl = location.coordinates ? 
                    `https://www.google.com/maps?q=${location.coordinates.latitude},${location.coordinates.longitude}` : '';

                html += `
                    <div style="background: #f8f9fa; border-radius: 8px; padding: 15px; margin-bottom: 15px; border-left: 4px solid #667eea;">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                            <div style="font-weight: 600; color: #495057; font-size: 16px;">
                                ${location.city}, ${location.state}, ${location.country}
                            </div>
                            <span style="padding: 4px 8px; border-radius: 12px; font-size: 12px; font-weight: 600; text-transform: uppercase; background: ${confidenceColor}; color: ${confidenceTextColor};">
                                ${location.confidence}
                            </span>
                        </div>
                        ${location.coordinates ? `
                            <div style="font-size: 14px; color: #6c757d; margin-bottom: 10px;">
                                📍 ${location.coordinates.latitude.toFixed(4)}, ${location.coordinates.longitude.toFixed(4)}
                            </div>
                            <a href="${mapsUrl}" target="_blank" style="display: inline-block; background: #667eea; color: white; text-decoration: none; padding: 6px 12px; border-radius: 6px; font-size: 12px; margin-bottom: 10px;">
                                🗺️ View on Google Maps
                            </a>
                        ` : ''}
                        <div style="font-size: 14px; color: #495057; line-height: 1.5;">
                            ${location.explanation}
                        </div>
                    </div>
                `;
            });
        }

        resultsContainer.innerHTML = html;
        this.overlay.appendChild(resultsContainer);
        document.body.appendChild(this.overlay);

        // Handle close button
        document.getElementById('closeOverlay').addEventListener('click', () => {
            this.hideResultsOverlay();
        });

        // Close on overlay click
        this.overlay.addEventListener('click', (e) => {
            if (e.target === this.overlay) {
                this.hideResultsOverlay();
            }
        });

        // Close on Escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.hideResultsOverlay();
            }
        });
    }

    hideResultsOverlay() {
        if (this.overlay) {
            document.body.removeChild(this.overlay);
            this.overlay = null;
        }
    }

    showNotification(message, type = 'info') {
        // Remove existing notification
        const existingNotification = document.querySelector('.geofinder-notification');
        if (existingNotification) {
            document.body.removeChild(existingNotification);
        }

        // Create notification
        const notification = document.createElement('div');
        notification.className = 'geofinder-notification';
        
        const bgColor = type === 'error' ? '#f8d7da' : type === 'success' ? '#d4edda' : '#e3f2fd';
        const textColor = type === 'error' ? '#721c24' : type === 'success' ? '#155724' : '#1976d2';
        const borderColor = type === 'error' ? '#dc3545' : type === 'success' ? '#28a745' : '#2196f3';

        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: ${bgColor};
            color: ${textColor};
            padding: 12px 16px;
            border-radius: 8px;
            border-left: 4px solid ${borderColor};
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            font-size: 14px;
            z-index: 100001;
            max-width: 300px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
            animation: slideIn 0.3s ease;
        `;

        notification.textContent = message;
        document.body.appendChild(notification);

        // Auto-remove after 5 seconds
        setTimeout(() => {
            if (notification.parentNode) {
                notification.style.animation = 'slideOut 0.3s ease';
                setTimeout(() => {
                    if (notification.parentNode) {
                        document.body.removeChild(notification);
                    }
                }, 300);
            }
        }, 5000);
    }

    hideNotification() {
        const notification = document.querySelector('.geofinder-notification');
        if (notification) {
            document.body.removeChild(notification);
        }
    }
}

// Add CSS animations
const style = document.createElement('style');
style.textContent = `
    @keyframes slideIn {
        from {
            transform: translateX(100%);
            opacity: 0;
        }
        to {
            transform: translateX(0);
            opacity: 1;
        }
    }
    
    @keyframes slideOut {
        from {
            transform: translateX(0);
            opacity: 1;
        }
        to {
            transform: translateX(100%);
            opacity: 0;
        }
    }
`;
document.head.appendChild(style);

// Initialize the content script
new GeoFinderContent(); 