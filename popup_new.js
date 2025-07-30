class GeoFinderPopup {
    constructor() {
        this.apiKey = '';
        this.selectedImage = null;
        this.currentMethod = 'upload';
        this.selectedModel = 'gemini-2.0-flash-lite-001';
        this.imageCache = new Map(); // Cache for storing images
        this.localization = new Localization(); // Initialize localization
        this.init();
    }

    init() {
        this.loadApiKey();
        this.setupEventListeners();
        this.updateUI();
    }

    loadApiKey() {
        chrome.storage.sync.get(['geminiApiKey', 'selectedModel', 'language'], (result) => {
            if (result.geminiApiKey) {
                this.apiKey = result.geminiApiKey;
                document.getElementById('apiKey').value = this.apiKey;
            }
            if (result.selectedModel) {
                this.selectedModel = result.selectedModel;
                document.getElementById('modelSelect').value = this.selectedModel;
                this.updateModelInfo(this.selectedModel);
            }
            if (result.language) {
                this.localization.setLanguage(result.language);
                document.getElementById('languageSelect').value = result.language;
            }
            this.updateAnalyzeButton();
        });
    }

    setupEventListeners() {
        // Settings button
        document.getElementById('settingsBtn').addEventListener('click', () => {
            this.openSettings();
        });

        // Close settings button
        document.getElementById('closeSettingsBtn').addEventListener('click', () => {
            this.closeSettings();
        });

        // API Key save button
        document.getElementById('saveApiKey').addEventListener('click', () => {
            this.saveApiKey();
        });

        // Language selection
        document.getElementById('languageSelect').addEventListener('change', (e) => {
            this.localization.setLanguage(e.target.value);
        });

        // Method tabs
        document.querySelectorAll('.method-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                this.switchMethod(tab.dataset.method);
            });
        });

        // Image upload area
        const uploadArea = document.getElementById('uploadArea');
        const imageInput = document.getElementById('imageInput');

        uploadArea.addEventListener('click', () => {
            imageInput.click();
        });

        uploadArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            uploadArea.classList.add('dragover');
        });

        uploadArea.addEventListener('dragleave', () => {
            uploadArea.classList.remove('dragover');
        });

        uploadArea.addEventListener('drop', (e) => {
            e.preventDefault();
            uploadArea.classList.remove('dragover');
            const files = e.dataTransfer.files;
            if (files.length > 0) {
                this.handleImageSelection(files[0]);
            }
        });

        imageInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                this.handleImageSelection(e.target.files[0]);
            }
        });

        // URL method
        document.getElementById('loadUrlBtn').addEventListener('click', () => {
            this.loadImageFromUrl();
        });

        document.getElementById('imageUrl').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.loadImageFromUrl();
            }
        });

        // Screen capture methods
        document.getElementById('captureTabBtn').addEventListener('click', () => {
            this.captureCurrentTab();
        });

        // Analyze button
        document.getElementById('analyzeBtn').addEventListener('click', () => {
            this.analyzeImage();
        });

        // Enter key in API key input
        document.getElementById('apiKey').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.saveApiKey();
            }
        });
    }

    async saveApiKey() {
        const apiKeyInput = document.getElementById('apiKey');
        const apiKey = apiKeyInput.value.trim();
        
        if (!apiKey) {
            this.showError(this.localization.getText('apiKeyRequired'));
            return;
        }

        // Show loading state
        const saveBtn = document.getElementById('saveApiKey');
        const originalText = saveBtn.textContent;
        saveBtn.textContent = 'Testing...';
        saveBtn.disabled = true;

        try {
            // Test API key and determine model type
            const modelType = await this.detectApiKeyType(apiKey);
            
            this.apiKey = apiKey;
            this.selectedModel = modelType;
            
            // Update UI
            document.getElementById('modelSelect').value = modelType;
            
            chrome.storage.sync.set({ 
                geminiApiKey: apiKey,
                selectedModel: modelType 
            }, () => {
                this.showSuccess(this.localization.getText('apiKeySaved'));
                this.updateModelInfo(modelType);
                this.updateAnalyzeButton();
            });
            
        } catch (error) {
            console.error('API key test failed:', error);
            this.showError(this.localization.getText('apiKeyInvalid'));
        } finally {
            // Reset button
            saveBtn.textContent = originalText;
            saveBtn.disabled = false;
        }
    }

    async detectApiKeyType(apiKey) {
        // First try Pro model
        try {
            const proResponse = await fetch(
                `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-pro:generateContent?key=${apiKey}`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: [{
                            parts: [{ text: "Test" }]
                        }],
                        generationConfig: {
                            maxOutputTokens: 10
                        }
                    })
                }
            );

            if (proResponse.ok) {
                return 'gemini-1.5-pro'; // Pro model works
            }
            
            // If Pro fails with 403/401, try Free model
            if (proResponse.status === 403 || proResponse.status === 401) {
                const freeResponse = await fetch(
                    `https://generativelanguage.googleapis.com/v1/models/gemini-2.0-flash-lite-001:generateContent?key=${apiKey}`,
                    {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            contents: [{
                                parts: [{ text: "Test" }]
                            }],
                            generationConfig: {
                                maxOutputTokens: 10
                            }
                        })
                    }
                );

                if (freeResponse.ok) {
                    return 'gemini-2.0-flash-lite-001'; // Free model works
                }
            }
            
            throw new Error('API key not valid for any model');
            
        } catch (error) {
            // If Pro fails with network error, try Free as fallback
            try {
                const freeResponse = await fetch(
                    `https://generativelanguage.googleapis.com/v1/models/gemini-2.0-flash-lite-001:generateContent?key=${apiKey}`,
                    {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            contents: [{
                                parts: [{ text: "Test" }]
                            }],
                            generationConfig: {
                                maxOutputTokens: 10
                            }
                        })
                    }
                );

                if (freeResponse.ok) {
                    return 'gemini-2.0-flash-lite-001'; // Free model works
                }
            } catch (fallbackError) {
                // Both failed
            }
            
            throw error;
        }
    }

    handleImageSelection(file) {
        if (!file.type.startsWith('image/')) {
            this.showError(this.localization.getText('unsupportedFormat'));
            return;
        }

        const reader = new FileReader();
        reader.onload = (e) => {
            // Clear previous image from cache
            this.clearPreviousImageFromCache();
            
            this.selectedImage = {
                file: file,
                dataUrl: e.target.result,
                base64: e.target.result.split(',')[1],
                method: 'upload'
            };
            // Cache the image for upload method
            this.imageCache.set('upload', this.selectedImage);
            this.updateUploadArea();
            this.updateAnalyzeButton();
        };
        reader.readAsDataURL(file);
    }

    updateUploadArea() {
        const uploadArea = document.getElementById('uploadArea');
        const uploadContent = uploadArea.querySelector('.upload-content');
        
        if (this.selectedImage) {
            uploadContent.innerHTML = `
                <img src="${this.selectedImage.dataUrl}" class="preview-image" alt="Preview">
                <p>${this.selectedImage.file ? this.selectedImage.file.name : 'Image loaded'}</p>
                <p style="font-size: 12px; color: #6c757d;">Click to change image</p>
            `;
        } else {
            uploadContent.innerHTML = `
                <span class="upload-icon">📷</span>
                <p>Click to select image or drag & drop</p>
            `;
        }
    }

    switchMethod(method) {
        this.currentMethod = method;
        
        // Update active tab
        document.querySelectorAll('.method-tab').forEach(tab => {
            tab.classList.toggle('active', tab.dataset.method === method);
        });
        
        // Update active content
        document.querySelectorAll('.method-content').forEach(content => {
            content.classList.toggle('active', content.id === `${method}Method`);
        });
        
        // Restore cached image for this method if available
        const cachedImage = this.imageCache.get(method);
        if (cachedImage) {
            this.selectedImage = cachedImage;
            this.updateAnalyzeButton();
            this.restorePreviews();
        } else {
            // Clear previous image when switching methods
            this.selectedImage = null;
            this.updateAnalyzeButton();
            this.clearPreviews();
        }
    }

    clearPreviews() {
        // Clear upload preview
        const uploadArea = document.getElementById('uploadArea');
        const uploadContent = uploadArea.querySelector('.upload-content');
        uploadContent.innerHTML = `
            <span class="upload-icon">📷</span>
            <p>Click to select image or drag & drop</p>
        `;
        
        // Clear URL preview
        document.getElementById('urlPreview').hidden = true;
        document.getElementById('imageUrl').value = '';
        
        // Clear screen preview
        document.getElementById('screenPreview').hidden = true;
        
        // Clear cache for current method
        this.imageCache.delete(this.currentMethod);
    }

    clearPreviousImageFromCache() {
        // Clear the previous image from cache for the current method
        if (this.selectedImage && this.selectedImage.method) {
            this.imageCache.delete(this.selectedImage.method);
        }
    }

    clearAllCache() {
        this.imageCache.clear();
    }

    restorePreviews() {
        if (!this.selectedImage) return;
        
        if (this.selectedImage.method === 'upload') {
            this.updateUploadArea();
        } else if (this.selectedImage.method === 'url') {
            const preview = document.getElementById('urlPreview');
            const previewImg = document.getElementById('urlPreviewImg');
            const previewText = document.getElementById('urlPreviewText');
            
            previewImg.src = this.selectedImage.dataUrl;
            previewText.textContent = 'Image loaded successfully';
            preview.hidden = false;
        } else if (this.selectedImage.method === 'screen') {
            const preview = document.getElementById('screenPreview');
            const previewImg = document.getElementById('screenPreviewImg');
            const previewText = document.getElementById('screenPreviewText');
            
            previewImg.src = this.selectedImage.dataUrl;
            previewText.textContent = 'Current tab captured';
            preview.hidden = false;
        }
    }

    updateAnalyzeButton() {
        const analyzeBtn = document.getElementById('analyzeBtn');
        analyzeBtn.disabled = !this.apiKey || !this.selectedImage;
    }

    async loadImageFromUrl() {
        const urlInput = document.getElementById('imageUrl');
        const url = urlInput.value.trim();
        
        if (!url) {
            this.showError(this.localization.getText('invalidUrl'));
            return;
        }

        try {
            // Show loading state
            const loadBtn = document.getElementById('loadUrlBtn');
            loadBtn.textContent = 'Loading...';
            loadBtn.disabled = true;

            // Fetch image from URL
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error('Failed to load image from URL');
            }

            const blob = await response.blob();
            const reader = new FileReader();
            
            reader.onload = (e) => {
                // Clear previous image from cache
                this.clearPreviousImageFromCache();
                
                this.selectedImage = {
                    dataUrl: e.target.result,
                    base64: e.target.result.split(',')[1],
                    source: 'url',
                    url: url,
                    method: 'url'
                };
                
                // Cache the image for URL method
                this.imageCache.set('url', this.selectedImage);
                
                // Show preview
                const preview = document.getElementById('urlPreview');
                const previewImg = document.getElementById('urlPreviewImg');
                const previewText = document.getElementById('urlPreviewText');
                
                previewImg.src = this.selectedImage.dataUrl;
                previewText.textContent = 'Image loaded successfully';
                preview.hidden = false;
                
                this.updateAnalyzeButton();
                
                // Reset button
                loadBtn.textContent = this.localization.getText('loadImage');
                loadBtn.disabled = false;
            };
            
            reader.readAsDataURL(blob);
            
        } catch (error) {
            console.error('URL loading error:', error);
            this.showError(this.localization.getText('imageLoadError'));
            
            // Reset button
            const loadBtn = document.getElementById('loadUrlBtn');
            loadBtn.textContent = this.localization.getText('loadImage');
            loadBtn.disabled = false;
        }
    }

    async captureCurrentTab() {
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            
            // Capture the current tab
            const dataUrl = await chrome.tabs.captureVisibleTab(null, { format: 'png' });
            
            // Convert to base64
            const base64 = dataUrl.split(',')[1];
            
            // Clear previous image from cache
            this.clearPreviousImageFromCache();
            
            this.selectedImage = {
                dataUrl: dataUrl,
                base64: base64,
                source: 'screen',
                type: 'tab',
                method: 'screen'
            };
            
            // Cache the image for screen method
            this.imageCache.set('screen', this.selectedImage);
            
            // Show preview
            const preview = document.getElementById('screenPreview');
            const previewImg = document.getElementById('screenPreviewImg');
            const previewText = document.getElementById('screenPreviewText');
            
            previewImg.src = dataUrl;
            previewText.textContent = 'Current tab captured';
            preview.hidden = false;
            
            this.updateAnalyzeButton();
            
        } catch (error) {
            console.error('Tab capture error:', error);
            this.showError(this.localization.getText('captureError'));
        }
    }

    async analyzeImage() {
        if (!this.apiKey || !this.selectedImage) {
            this.showError(this.localization.getText('imageRequired'));
            return;
        }

        const analyzeBtn = document.getElementById('analyzeBtn');
        const btnText = analyzeBtn.querySelector('.btn-text');
        const spinner = analyzeBtn.querySelector('.loading-spinner');

        // Show loading state
        btnText.textContent = this.localization.getText('analyzing');
        spinner.hidden = false;
        analyzeBtn.disabled = true;

        try {
            const context = document.getElementById('context').value.trim();

            const result = await this.callGeminiAPI(this.selectedImage.base64, context);
            this.displayResults(result);
        } catch (error) {
            console.error('Analysis error:', error);
            
            // Check for specific API errors
            if (error.message.includes('503') || error.message.includes('overloaded')) {
                this.showError(this.localization.getText('analysisError'));
            } else if (error.message.includes('401') || error.message.includes('403')) {
                this.showError(this.localization.getText('apiKeyInvalid'));
            } else if (error.message.includes('429')) {
                this.showError(this.localization.getText('analysisError'));
            } else {
                this.showError(this.localization.getText('networkError'));
            }
        } finally {
            // Reset button state
            btnText.textContent = this.localization.getText('analyzeImage');
            spinner.hidden = true;
            analyzeBtn.disabled = false;
        }
    }

    async callGeminiAPI(imageBase64, context, retryCount = 0) {
        const prompt = this.buildPrompt(context);
        
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
            `https://generativelanguage.googleapis.com/v1/models/${this.selectedModel}:generateContent?key=${this.apiKey}`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(requestBody)
            }
        );

        if (!response.ok) {
            const errorText = await response.text();
            
            // Retry logic for 503 errors (overloaded)
            if (response.status === 503 && retryCount < 3) {
                console.log(`API overloaded, retrying in ${(retryCount + 1) * 2} seconds... (attempt ${retryCount + 1}/3)`);
                await new Promise(resolve => setTimeout(resolve, (retryCount + 1) * 2000));
                return this.callGeminiAPI(imageBase64, context, retryCount + 1);
            }
            
            throw new Error(`API Error ${response.status}: ${errorText}`);
        }

        const data = await response.json();
        
        if (!data.candidates || !data.candidates[0] || !data.candidates[0].content) {
            throw new Error('Invalid response from Gemini API');
        }

        const responseText = data.candidates[0].content.parts[0].text;
        
        try {
            return JSON.parse(responseText);
        } catch (parseError) {
            console.error('Failed to parse JSON response:', responseText);
            throw new Error('Invalid JSON response from API');
        }
    }

    buildPrompt(context) {
        // Use localized prompt based on current language
        const isTurkish = this.localization.currentLanguage === 'tr';
        
        let prompt = isTurkish ? 
            `Sen profesyonel bir konum belirleme uzmanısın. Aşağıdaki formatta geçerli bir JSON nesnesi ile yanıt vermelisin:

{
  "interpretation": "Görüntünün kapsamlı analizi, şunları içerir:
    - Mimari stil ve dönem
    - Önemli yer işaretleri veya ayırt edici özellikler
    - Doğal çevre ve iklim göstergeleri
    - Kültürel unsurlar (tabelalar, araçlar, kıyafetler, vb.)
    - Görünür metin veya dil
    - Zaman dönemi göstergeleri (varsa)",
  "locations": [
    {
      "country": "Birincil ülke adı",
      "state": "Eyalet/bölge/il adı",
      "city": "Şehir adı",
      "confidence": "Yüksek/Orta/Düşük",
      "coordinates": {
        "latitude": 12.3456,
        "longitude": 78.9012
      },
      "explanation": "Bu konum tanımlaması için detaylı gerekçe, şunları içerir:
        - Bu konumla eşleşen belirli mimari özellikler
        - Bu konumu destekleyen çevresel özellikler
        - Bu bölgeyi gösteren kültürel unsurlar
        - Ayırt edici yer işaretleri veya özellikler
        - Görünür metin veya tabelalardan destekleyici kanıtlar"
    }
  ]
}

ÖNEMLİ: 
1. Yanıtınız geçerli bir JSON nesnesi olmalıdır. JSON nesnesinden önce veya sonra herhangi bir metin dahil etmeyin.
2. Markdown biçimlendirmesi veya kod blokları dahil etmeyin.
3. Yanıt JSON.parse() ile ayrıştırılabilir olmalıdır.
4. Tek bir konum hakkında tam olarak emin değilseniz, üç olası konum sağlayabilirsiniz.
5. Konumları güven seviyesine göre sıralayın (en yüksekten en düşüğe).
6. Mümkün olduğunda her konum için yaklaşık koordinatları (enlem ve boylam) her zaman dahil edin.

Doğru konum tanımlaması için bu temel yönleri göz önünde bulundurun:
1. Mimari Analiz:
   - Bina stilleri ve malzemeleri
   - Çatı türleri ve yapım yöntemleri
   - Pencere ve kapı tasarımları
   - Dekoratif unsurlar ve süslemeler

2. Çevresel Göstergeler:
   - Bitki türleri ve desenleri
   - İklim göstergeleri (kar, çöl, tropikal, vb.)
   - Arazi ve topografya
   - Su kütleleri veya kıyı özellikleri

3. Kültürel Bağlam:
   - Görünür metnin dili
   - Araç türleri ve stilleri
   - Kıyafet ve moda
   - Sokak mobilyaları ve altyapı
   - Ticari tabelalar ve markalama

4. Zaman Dönemi Göstergeleri:
   - Mimari dönem
   - Araç modelleri
   - Moda stilleri
   - Görünür teknoloji` :
            
            `You are a professional geolocation expert. You MUST respond with a valid JSON object in the following format:

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
   - Technology visible`;

        if (context) {
            prompt += isTurkish ? 
                `\n\nKullanıcı tarafından sağlanan ek bağlam:\n${context}` :
                `\n\nAdditional context provided by the user:\n${context}`;
        }

        prompt += isTurkish ? 
            '\n\nHatırlatma: Yanıtınız sadece geçerli bir JSON nesnesi olmalıdır. Ek metin veya biçimlendirme dahil etmeyin.' :
            '\n\nRemember: Your response must be a valid JSON object only. No additional text or formatting.';
        
        return prompt;
    }

    displayResults(result) {
        const resultsSection = document.getElementById('resultsSection');
        const resultsContent = document.getElementById('resultsContent');

        if (result.error) {
            resultsContent.innerHTML = `
                <div class="error-message">
                    <strong>Error:</strong> ${result.error}
                    ${result.details ? `<br><small>${result.details}</small>` : ''}
                </div>
            `;
        } else {
            let html = '';

            // Display interpretation
            if (result.interpretation) {
                html += `
                    <div class="interpretation">
                        <h4>Image Analysis</h4>
                        <p>${result.interpretation}</p>
                    </div>
                `;
            }

            // Display locations
            if (result.locations && result.locations.length > 0) {
                html += '<div class="locations">';
                result.locations.forEach((location, index) => {
                    const confidenceClass = location.confidence?.toLowerCase() || 'unknown';
                    const mapsUrl = location.coordinates ? 
                        `https://www.google.com/maps?q=${location.coordinates.latitude},${location.coordinates.longitude}` : '';
                    
                    html += `
                        <div class="location-card ${confidenceClass}">
                            <div class="location-header">
                                <h4>${this.localization.getText('location')} ${index + 1}</h4>
                                <span class="confidence ${confidenceClass}">${this.localization.getText('confidence')}: ${location.confidence || this.localization.getText('unknown')}</span>
                            </div>
                            <div class="location-details">
                                <div class="detail-item">
                                    <strong>${this.localization.getText('country')}:</strong> ${location.country || this.localization.getText('unknown')}
                                </div>
                                ${location.state ? `<div class="detail-item"><strong>${this.localization.getText('region')}:</strong> ${location.state}</div>` : ''}
                                ${location.city ? `<div class="detail-item"><strong>${this.localization.getText('city')}:</strong> ${location.city}</div>` : ''}
                                ${location.coordinates ? `
                                    <div class="detail-item">
                                        <strong>${this.localization.getText('coordinates')}:</strong>
                                        📍 ${location.coordinates.latitude.toFixed(4)}, ${location.coordinates.longitude.toFixed(4)}
                                    </div>
                                    <a href="${mapsUrl}" target="_blank" class="maps-link">
                                        🗺️ View on Google Maps
                                    </a>
                                ` : ''}
                            </div>
                            <div class="explanation">
                                ${location.explanation}
                            </div>
                        </div>
                    `;
                });
                html += '</div>';
            }

            resultsContent.innerHTML = html;
        }

        resultsSection.hidden = false;
        resultsSection.scrollIntoView({ behavior: 'smooth' });
    }

    showError(message) {
        console.error(message);
        this.showNotification(message, 'error');
    }

    showSuccess(message) {
        console.log(message);
        this.showNotification(message, 'success');
    }

    showNotification(message, type) {
        // Remove existing notification
        const existingNotification = document.getElementById('notification');
        if (existingNotification) {
            existingNotification.remove();
        }

        // Create notification element
        const notification = document.createElement('div');
        notification.id = 'notification';
        notification.className = `notification notification-${type}`;
        notification.innerHTML = `
            <div class="notification-content">
                <span class="notification-icon">${type === 'error' ? '❌' : '✅'}</span>
                <span class="notification-text">${message}</span>
                <button class="notification-close" onclick="this.parentElement.parentElement.remove()">×</button>
            </div>
        `;

        // Add to page
        document.body.appendChild(notification);

        // Auto remove after 5 seconds
        setTimeout(() => {
            if (notification.parentElement) {
                notification.remove();
            }
        }, 5000);
    }

    updateModelInfo(modelType) {
        const modelInfo = document.getElementById('modelInfo');
        const modelStatus = document.getElementById('modelStatus');
        
        if (modelType === 'gemini-1.5-pro') {
            modelStatus.innerHTML = '🚀 <strong>Pro Model</strong> - Enhanced analysis capabilities';
            modelInfo.style.background = '#d4edda';
            modelInfo.style.color = '#155724';
        } else {
            modelStatus.innerHTML = '🆓 <strong>Free Model</strong> - Basic analysis capabilities';
            modelInfo.style.background = '#fff3cd';
            modelInfo.style.color = '#856404';
        }
        
        modelInfo.style.display = 'block';
    }

    openSettings() {
        document.getElementById('settingsSection').hidden = false;
        document.getElementById('mainContent').hidden = true;
    }

    closeSettings() {
        document.getElementById('settingsSection').hidden = true;
        document.getElementById('mainContent').hidden = false;
    }

    updateUI() {
        // Update UI based on current state
        this.updateAnalyzeButton();
    }
}

// Initialize the popup when the DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new GeoFinderPopup();
}); 