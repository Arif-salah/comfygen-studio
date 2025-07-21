(async () => {
    // --- UI Element References for ComfyUI Connection ---
    const comfyUiAddressInput = document.getElementById('comfyUiAddress');
    const connectComfyUiButton = document = document.getElementById('connectComfyUiButton');
    const connectionStatusText = document.getElementById('connectionStatus');

    let comfyUiBaseUrl = ''; // This will store the base URL for ComfyUI
    let currentSocket = null; // To manage the WebSocket connection

    // --- Core UI Element References ---
    const subjectPromptElement = document.getElementById('subjectPrompt');
    const clothingPromptElement = document.getElementById('clothingPrompt');
    const qualityTagsElement = document.getElementById('qualityTags');
    const negativePromptElement = document.getElementById('negativePrompt');
    const seedElement = document.getElementById('seed');
    const randomSeedButton = document.getElementById('randomSeedButton');
    const autoRandomSeedButton = document.getElementById('autoRandomSeed');
    const upscaleToggle = document.getElementById('upscaleToggle');
    const faceDetailerToggle = document.getElementById('faceDetailerToggle');
    const ckptSelect = document.getElementById('ckpt_name');
    const stepsElement = document.getElementById('steps');
    const cfgElement = document.getElementById('cfg');
    const samplerElement = document = document.getElementById('sampler_name');
    const denoiseElement = document.getElementById('denoise');
    const resolutionElement = document.getElementById('resolution');
    const customWidthElement = document.getElementById('customWidth');
    const customHeightElement = document.getElementById('customHeight');
    const addLoraButton = document.getElementById('addLoraButton');
    const loraFieldsContainer = document.getElementById('lora-fields-container');
    const noLorasMessage = document.querySelector('.no-loras-message');
    const generateImageButton = document.getElementById('generateImageButton');
    const generatedImage = document.getElementById('generatedImage');
    const mainProgressBar = document.getElementById('mainProgressBar');
    const progressText = document.getElementById('progressText');
    const imageLoadingOverlay = document.getElementById('imageLoadingOverlay');

    // Face Detailer UI elements
    const faceDetailerSettingsPanel = document.getElementById('faceDetailerSettingsPanel');
    const detailerGuideSizeElement = document.getElementById('detailerGuideSize');
    const detailerDenoiseElement = document.getElementById('detailerDenoise');
    const detailerBboxThresholdElement = document.getElementById('detailerBboxThreshold');
    const detailerSamHintElement = document.getElementById('detailerSamHint');


    let currentWorkflow = null;
    const clientId = uuidv4();
    let loraCounter = 0; // To keep track of dynamically added LoRA fields
    let autoRandomSeedEnabled = false; // State for auto-seed
    let upscaleEnabled = false; // State for upscale toggle
    let faceDetailerEnabled = false; // State for face detailer toggle

    // --- Utility Functions ---
    function uuidv4() {
        return ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, c =>
            (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16));
    }

    function showMessageBox(message, type = 'error', duration = 3000) {
        const messageBox = document.createElement('div');
        messageBox.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background-color: ${type === 'error' ? '#f44336' : '#4CAF50'};
            color: white;
            padding: 15px 25px;
            border-radius: 8px;
            box-shadow: 0 4px 15px rgba(0,0,0,0.3);
            z-index: 9999;
            font-family: 'Inter', sans-serif;
            animation: fadeInOut 3s forwards;
        `;
        messageBox.innerText = message;
        document.body.appendChild(messageBox);

        setTimeout(() => {
            messageBox.remove();
        }, duration);
    }

    /**
     * Sets the enabled state of all input controls.
     * @param {boolean} enable - True to enable, false to disable.
     */
    function setControlsEnabled(enable) {
        const controls = document.querySelectorAll(
            '.text-input, .select-input, .checkbox-input, input[type="range"], .action-button, .primary-button'
        );
        controls.forEach(control => {
            // Exclude the ComfyUI address input and connect button from being disabled by this function
            if (control.id !== 'comfyUiAddress' && control.id !== 'connectComfyUiButton') {
                control.disabled = !enable;
            }
        });
        // Special handling for generate button as it's often disabled during generation
        if (enable) {
            generateImageButton.disabled = false;
            generateImageButton.textContent = 'Generate Image';
        } else {
            generateImageButton.disabled = true;
            generateImageButton.textContent = 'Disconnected';
        }
    }

    // Initially disable controls until connected
    setControlsEnabled(false);
    comfyUiAddressInput.disabled = false;
    connectComfyUiButton.disabled = false;


    // --- ComfyUI Connection Logic ---
    async function connectToComfyUI() {
        const address = comfyUiAddressInput.value.trim();
        if (!address) {
            showMessageBox("Please enter a ComfyUI server address.", 'error');
            return;
        }

        // Validate address format (simple check for IP:Port)
        const addressRegex = /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}:[0-9]{1,5}$|^localhost:[0-9]{1,5}$/;
        if (!addressRegex.test(address)) {
            showMessageBox("Invalid address format. Use IP:Port (e.g., 192.168.1.252:8188).", 'error');
            return;
        }

        comfyUiBaseUrl = `http://${address}`;
        const wsUrl = `ws://${address}/ws?clientId=${clientId}`;

        connectionStatusText.textContent = 'Connecting...';
        connectionStatusText.style.color = 'orange';
        setControlsEnabled(false); // Disable controls during connection attempt

        // Close existing socket if any
        if (currentSocket) {
            currentSocket.close();
            currentSocket = null;
        }

        try {
            // Test API connectivity by fetching checkpoint list
            const testRes = await fetch(`${comfyUiBaseUrl}/object_info/CheckpointLoaderSimple`);
            if (!testRes.ok) {
                throw new Error(`HTTP error! status: ${testRes.status}`);
            }
            await loadCheckpointList(); // Load actual data
            await loadLoraList(); // Load actual data

            // Establish WebSocket connection
            currentSocket = new WebSocket(wsUrl);

            currentSocket.onopen = () => {
                console.log('✅ Connected to ComfyUI WebSocket');
                connectionStatusText.textContent = 'Connected!';
                connectionStatusText.style.color = 'green';
                setControlsEnabled(true); // Enable controls on successful connection
                localStorage.setItem('comfyUiAddress', address); // Save address
            };

            currentSocket.onmessage = handleSocketMessage;

            currentSocket.onclose = () => {
                console.log('❌ Disconnected from ComfyUI WebSocket');
                connectionStatusText.textContent = 'Disconnected';
                connectionStatusText.style.color = 'red';
                setControlsEnabled(false); // Disable controls on disconnect
                showMessageBox("Disconnected from ComfyUI. Please reconnect.", 'error', 5000);
            };

            currentSocket.onerror = (error) => {
                console.error('WebSocket error:', error);
                connectionStatusText.textContent = 'Connection Error';
                connectionStatusText.style.color = 'red';
                setControlsEnabled(false);
                showMessageBox("WebSocket connection error. Check server address and CORS.", 'error', 5000);
            };

        } catch (error) {
            console.error('Failed to connect to ComfyUI:', error);
            connectionStatusText.textContent = 'Connection Failed';
            connectionStatusText.style.color = 'red';
            setControlsEnabled(false);
            showMessageBox(`Failed to connect to ComfyUI at ${address}. Error: ${error.message}. Check server status and CORS settings.`, 'error', 7000);
        }
    }


    // --- Data Fetching Functions ---
    async function fetchComfyUIObjectInfo(nodeType) {
        if (!comfyUiBaseUrl) {
            showMessageBox("ComfyUI server not connected. Please connect first.", 'error');
            return null;
        }
        try {
            const res = await fetch(`${comfyUiBaseUrl}/object_info/${nodeType}`);
            const data = await res.json();
            return data;
        } catch (err) {
            console.error(`❌ Failed to fetch ${nodeType} list from ${comfyUiBaseUrl}:`, err);
            showMessageBox(`Error loading ${nodeType} list. Ensure ComfyUI is running and accessible at ${comfyUiBaseUrl}.`, 'error');
            return null;
        }
    }

    async function loadCheckpointList() {
        const data = await fetchComfyUIObjectInfo('CheckpointLoaderSimple');
        const ckptArray = data?.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0];

        if (Array.isArray(ckptArray)) {
            ckptSelect.innerHTML = '';
            ckptArray.forEach(name => {
                const option = document.createElement('option');
                option.value = name;
                option.textContent = name;
                ckptSelect.appendChild(option);
            });
            const saved = localStorage.getItem('ckpt_name');
            if (saved && ckptArray.includes(saved)) {
                ckptSelect.value = saved;
            }
        } else {
            ckptSelect.innerHTML = `<option disabled selected>Error loading</option>`;
        }
    }

    let availableLoras = [];
    async function loadLoraList() {
        try {
            const data = await fetchComfyUIObjectInfo('LoraLoader');
            const loraArray = data?.LoraLoader?.input?.required?.lora_name?.[0];
            if (Array.isArray(loraArray)) {
                availableLoras = loraArray;
                // Update existing LoRA fields if any
                document.querySelectorAll('.lora-select').forEach(select => {
                    const savedValue = select.value; // Store current value
                    select.innerHTML = '<option value="None">None</option>' + availableLoras.map(name => `<option value="${name}">${name}</option>`).join('');
                    if (savedValue && (savedValue === "None" || availableLoras.includes(savedValue))) {
                        select.value = savedValue;
                    } else {
                        // Explicitly set to "None" if saved value is invalid or not found
                        select.value = "None";
                    }
                });
            } else {
                showMessageBox("Could not load LoRA list or list is empty.", 'error');
                availableLoras = []; // Ensure it's empty if data fetch fails
                // Also update existing selects to only have 'None'
                document.querySelectorAll('.lora-select').forEach(select => {
                    select.innerHTML = '<option value="None">None</option>';
                    select.value = "None";
                });
            }
        } catch (error) {
            console.error("Error loading LoRA list:", error);
            showMessageBox("Error loading LoRA list.", 'error');
            availableLoras = []; // Ensure it's empty on error
            // Also update existing selects to only have 'None'
            document.querySelectorAll('.lora-select').forEach(select => {
                select.innerHTML = '<option value="None">None</option>';
                select.value = "None";
            });
        }
    }

    async function loadWorkflow(workflowPath) {
        try {
            const response = await fetch(workflowPath);
            currentWorkflow = await response.json();
            console.log('✅ Workflow Loaded:', workflowPath, currentWorkflow);
            // Store the path to know which workflow is currently loaded
            currentWorkflow.__workflowPath = workflowPath;
            updateResolutionUI(); // Update UI based on loaded workflow's default resolution
        } catch (error) {
            console.error('❌ Error loading workflow:', error);
            showMessageBox('Error loading workflow. Please try again.', 'error');
        }
    }

    // --- UI Update & Dynamic Field Management ---
    function updateProgress(max = 0, value = 0) {
        mainProgressBar.max = max;
        mainProgressBar.value = value;

        if (max > 0 && value < max) {
            progressText.textContent = `Generating: ${Math.round((value / max) * 100)}%`;
            imageLoadingOverlay.style.display = 'flex';
            generateImageButton.disabled = true;
            generateImageButton.textContent = 'Generating...';
        } else if (value === max && max > 0) {
            progressText.textContent = 'Processing final image...';
        } else {
            progressText.textContent = 'Ready';
            imageLoadingOverlay.style.display = 'none';
            generateImageButton.disabled = false;
            generateImageButton.textContent = 'Generate Image';
        }
    }
    // Expose updateProgress globally for socket messages
    window.updateProgress = updateProgress;

    function updateImage(filename, subfolder) {
        if (!filename) {
            console.error("🚨 Error: No filename received from ComfyUI.");
            return;
        }
        if (!comfyUiBaseUrl) {
            showMessageBox("ComfyUI server not connected. Cannot display image.", 'error');
            return;
        }

        let folder = subfolder && subfolder.trim() !== "" ? subfolder : "";

        if (filename.includes("\\")) {
            filename = filename.split("\\").pop();
        }

        const rand = Math.random();
        // Use the dynamic comfyUiBaseUrl for image fetching
        const imageUrl = `${comfyUiBaseUrl}/view?filename=${filename}&type=output&subfolder=${folder}&rand=${rand}`;

        console.log(`🖼️ Loading Image: ${imageUrl}`);
        generatedImage.src = imageUrl;
    }

    function addLoraField(loraName = "None", loraWeight = 1.0) {
        loraCounter++;
        const loraId = `lora${loraCounter}`;
        const loraWeightId = `lora${loraCounter}_wt`;

        const loraHtml = `
            <div class="lora-field-row" id="lora-row-${loraCounter}">
                <section class="control-group">
                    <label for="${loraId}" class="control-label">LoRA ${loraCounter}</label>
                    <select id="${loraId}" class="select-input lora-select">
                        <option value="None">None</option>
                        ${availableLoras.map(name => `<option value="${name}">${name}</option>`).join('')}
                    </select>
                    <div class="slider-group">
                        <input type="range" id="${loraWeightId}" min="0" max="2" step="0.01" value="${loraWeight}" oninput="updateSliderValue('${loraWeightId}')">
                        <span class="slider-value" id="${loraWeightId}_value">${loraWeight.toFixed(2)}</span>
                    </div>
                </section>
                <button class="action-button remove-button" data-lora-id="${loraCounter}">Remove</button>
            </div>
        `;
        loraFieldsContainer.insertAdjacentHTML('beforeend', loraHtml);

        // Set initial values
        document.getElementById(loraId).value = loraName;
        document.getElementById(loraWeightId).value = loraWeight;
        updateSliderValue(loraWeightId);

        // Add event listeners for the new elements
        document.getElementById(loraId).addEventListener('change', updateLoraInputs);
        document.getElementById(loraWeightId).addEventListener('input', updateLoraInputs);
        document.getElementById(loraWeightId).addEventListener('change', updateLoraInputs); // For immediate update on release

        document.querySelector(`#lora-row-${loraCounter} .remove-button`).addEventListener('click', (event) => {
            event.target.closest('.lora-field-row').remove();
            updateLoraInputs(); // Recalculate LoRA stack and save
            checkNoLorasMessage();
        });

        checkNoLorasMessage();
        saveLorasToLocalStorage(); // Save after adding
    }

    function checkNoLorasMessage() {
        if (loraFieldsContainer.querySelectorAll('.lora-field-row').length === 0) {
            noLorasMessage.style.display = 'block';
        } else {
            noLorasMessage.style.display = 'none';
        }
    }

    // Function to update resolution UI based on workflow
    function updateResolutionUI() {
        const savedResolution = localStorage.getItem('resolution');
        if (savedResolution) {
            resolutionElement.value = savedResolution;
        } else {
            if (upscaleEnabled) {
                resolutionElement.value = '1344x768'; // Default for upscale workflow
            } else {
                resolutionElement.value = '768x1344'; // Default for non-upscale workflow
            }
        }
        toggleCustomResolution(resolutionElement.value); // Update custom resolution visibility
        updateSliderValue('denoise'); // Ensure denoise slider value is correct
    }


    // --- ComfyUI WebSocket & Prompt Queueing ---
    function handleSocketMessage(event) {
        const data = JSON.parse(event.data);

        if (data.type === 'status') {
            updateProgress(0, 0);
        } else if (data.type === 'execution_start') {
            updateProgress(100, 1);
        } else if (data.type === 'progress') {
            updateProgress(data['data']['max'], data['data']['value']);
        } else if (data.type === 'executed' && 'images' in data['data']['output']) {
            const images = data['data']['output']['images'];
            if (images.length > 0) {
                let savedImages = images.filter(img => img.type === "output");
                if (savedImages.length > 0) {
                    let lastSavedImage = savedImages[savedImages.length - 1];
                    updateImage(lastSavedImage.filename, lastSavedImage.subfolder);
                    updateProgress(1, 1); // Indicate completion
                } else {
                    console.warn("⚠️ No saved images found. Ignoring temp images.");
                    updateProgress(0, 0); // Reset on warning
                }
            } else {
                console.warn("⚠️ No images found in response.");
                updateProgress(0, 0); // Reset on warning
            }
        }
    }

    async function queuePromptWithInputs() {
        if (!currentWorkflow) {
            showMessageBox("Workflow not loaded yet. Please wait.", 'error');
            return;
        }
        if (!comfyUiBaseUrl || !currentSocket || currentSocket.readyState !== WebSocket.OPEN) {
            showMessageBox("Not connected to ComfyUI server. Please connect first.", 'error');
            return;
        }

        // Determine which workflow to use based on upscaleEnabled
        const workflowPathToLoad = upscaleEnabled ? '/comfygen/js/base_workflow.json' : '/comfygen/js/base_workflow2.json';
        // Only load if the workflow needs to change
        if (!currentWorkflow || currentWorkflow.__workflowPath !== workflowPathToLoad) {
            await loadWorkflow(workflowPathToLoad);
            // The loadWorkflow function now sets currentWorkflow.__workflowPath and calls updateResolutionUI
        }

        // Clone workflow to avoid modifying the original loaded object
        const workflowToQueue = JSON.parse(JSON.stringify(currentWorkflow));

        // IMPORTANT: Remove the internal __workflowPath property before sending to ComfyUI
        delete workflowToQueue.__workflowPath;

        // --- Update Workflow Nodes with UI Values ---

        // Seed (Node 74)
        if (workflowToQueue['74']) {
            // Apply auto-seed if enabled
            if (autoRandomSeedEnabled) {
                let largeRandom = Math.floor(Math.random() * 9999999999999);
                seedElement.value = largeRandom;
            }
            workflowToQueue['74']['inputs']['seed'] = Number(seedElement.value);
        } else {
            console.warn("Node 74 (Seed) not found in workflow.");
        }

        // Prompts (Nodes 10:1, 10:0, 18, 7)
        if (workflowToQueue['10:1']) { // Node 10:1 'description' (Subject)
            workflowToQueue['10:1']['inputs']['text'] = subjectPromptElement.value;
        }
        if (workflowToQueue['10:0']) { // Node 10:0 'Clothing'
            workflowToQueue['10:0']['inputs']['text'] = clothingPromptElement.value;
        }
        if (workflowToQueue['18']) { // Node 18 'text' (Quality Tags)
            workflowToQueue['18']['inputs']['text'] = qualityTagsElement.value;
        }
        if (workflowToQueue['7']) { // Node 7 (Negative Prompt)
            workflowToQueue['7']['inputs']['text'] = negativePromptElement.value;
        } else {
            console.warn("Prompt nodes (10:1, 10:0, 18, 7) not fully found in workflow.");
        }

        // KSampler (Node 3 or 31 depending on workflow)
        // Note: Both workflows use Node 3 as the primary KSampler. Workflow1 has an additional KSampler at 31.
        const primaryKSamplerNodeId = '3';
        if (workflowToQueue[primaryKSamplerNodeId]) {
            workflowToQueue[primaryKSamplerNodeId]['inputs']['steps'] = Number(stepsElement.value);
            workflowToQueue[primaryKSamplerNodeId]['inputs']['cfg'] = Number(cfgElement.value);
            workflowToQueue[primaryKSamplerNodeId]['inputs']['sampler_name'] = samplerElement.value;
            workflowToQueue[primaryKSamplerNodeId]['inputs']['denoise'] = Number(denoiseElement.value);
        } else {
            console.warn(`KSampler node (${primaryKSamplerNodeId}) not found in workflow.`);
        }
        // If workflow1 (upscaled), update the second KSampler (Node 31) as well
        if (upscaleEnabled && workflowToQueue['31']) { // Check upscaleEnabled here
             workflowToQueue['31']['inputs']['steps'] = Number(stepsElement.value); // Use same steps
             workflowToQueue['31']['inputs']['cfg'] = Number(cfgElement.value); // Use same cfg
             workflowToQueue['31']['inputs']['sampler_name'] = samplerElement.value; // Use same sampler
             // Denoise for the second KSampler (Node 31) is fixed at 0.5 in the workflow,
             // so we don't expose it to the common denoise slider.
        }


        // Checkpoint (Node 4)
        if (workflowToQueue['4']) {
            workflowToQueue['4']['inputs']['ckpt_name'] = ckptSelect.value;
        } else {
            console.warn("Node 4 (CheckpointLoaderSimple) not found in workflow.");
        }

        // Resolution (Node 5 or 160) - Now controlled solely by UI
        let width, height;
        if (resolutionElement.value === 'custom') {
            width = Number(customWidthElement.value);
            height = Number(customHeightElement.value);
            if (!width || !height || width <= 0 || height <= 0) {
                showMessageBox("Please enter valid custom width and height.", 'error');
                return;
            }
        } else {
            [width, height] = resolutionElement.value.split('x').map(Number);
        }

        if (workflowToQueue['5']) { // EmptyLatentImage (used in workflow1)
            workflowToQueue['5']['inputs']['width'] = width;
            workflowToQueue['5']['inputs']['height'] = height;
        }
        if (workflowToQueue['160']) { // CM_SDXLResolution (used in workflow2)
            workflowToQueue['160']['inputs']['resolution'] = `${width}x${height}`;
        } else if (!workflowToQueue['5']) { // If neither is found, warn
            console.warn("Resolution node (5 or 160) not found in workflow.");
        }

        // LoRA Stacker (Node 163)
        if (workflowToQueue['163']) {
            // Reset all LoRA inputs in the workflow first to "None"
            const maxLoraCount = workflowToQueue['163']['inputs']['lora_count'] || 49; // Use workflow's lora_count or default to 49
            for (let i = 1; i <= maxLoraCount; i++) {
                workflowToQueue['163']['inputs'][`lora_name_${i}`] = "None";
                workflowToQueue['163']['inputs'][`lora_wt_${i}`] = 1; // Default weight
                workflowToQueue['163']['inputs'][`model_str_${i}`] = 1; // Default model strength
                workflowToQueue['163']['inputs'][`clip_str_${i}`] = 1; // Default clip strength
            }

            // Populate with active UI LoRAs
            const loraRows = loraFieldsContainer.querySelectorAll('.lora-field-row');
            let activeLoraCount = 0; // Track only active LoRAs
            loraRows.forEach((row, index) => {
                const loraSelect = row.querySelector('.lora-select');
                const loraWeightInput = row.querySelector('input[type="range"]');
                if (loraSelect && loraWeightInput && loraSelect.value !== "None") { // Only process if a LoRA is actually selected
                    if (activeLoraCount < maxLoraCount) { // Ensure we don't exceed workflow's supported LoRA count
                        workflowToQueue['163']['inputs'][`lora_name_${activeLoraCount + 1}`] = loraSelect.value;
                        workflowToQueue['163']['inputs'][`lora_wt_${activeLoraCount + 1}`] = parseFloat(loraWeightInput.value);
                        workflowToQueue['163']['inputs'][`model_str_${activeLoraCount + 1}`] = 1;
                        workflowToQueue['163']['inputs'][`clip_str_${activeLoraCount + 1}`] = 1;
                        activeLoraCount++;
                    }
                }
            });
            // Set lora_count to the actual number of active LoRAs
            workflowToQueue['163']['inputs']['lora_count'] = activeLoraCount;
        } else {
            console.warn("Node 163 (LoRA Stacker) not found in workflow.");
        }

        // --- Post-Processing Wiring (Face Detailer) ---
        let currentImageSourceNodeId;
        let currentImageSourceOutputIndex;
        let finalSaveImageNodeId;

        if (upscaleEnabled) { // Workflow1 (upscaled)
            currentImageSourceNodeId = '8'; // VAEDecode output from upscaled KSampler (31)
            currentImageSourceOutputIndex = 0;
            finalSaveImageNodeId = '159';
            // Ensure PreviewImage 33 is connected to KSampler 3's output
            if (workflowToQueue['33']) {
                workflowToQueue['33']['inputs']['images'] = ['3', 0];
            }

            // Face Detailer (Node 133) - Only active if upscale is enabled AND faceDetailerToggle is checked
            if (faceDetailerToggle.checked && workflowToQueue['133']) {
                workflowToQueue['133']['inputs']['image'] = [currentImageSourceNodeId, currentImageSourceOutputIndex];
                workflowToQueue['133']['inputs']['guide_size'] = Number(detailerGuideSizeElement.value);
                workflowToQueue['133']['inputs']['denoise'] = Number(detailerDenoiseElement.value);
                workflowToQueue['133']['inputs']['bbox_threshold'] = Number(detailerBboxThresholdElement.value);
                workflowToQueue['133']['inputs']['sam_detection_hint'] = detailerSamHintElement.value;
                currentImageSourceNodeId = '133'; // Output of FaceDetailer becomes the new source
                currentImageSourceOutputIndex = 0; // Output of FaceDetailer
                // Also update preview images related to detailer
                if (workflowToQueue['137']) workflowToQueue['137']['inputs']['images'] = ['133', 0];
                if (workflowToQueue['142']) workflowToQueue['142']['inputs']['mask'] = ['133', 3];
                if (workflowToQueue['143']) workflowToQueue['143']['inputs']['images'] = ['133', 1];
                if (workflowToQueue['144']) workflowToQueue['144']['inputs']['images'] = ['133', 2];
            } else {
                // If Face Detailer is disabled or not in workflow, ensure its related preview nodes are bypassed
                if (workflowToQueue['137']) workflowToQueue['137']['inputs']['images'] = [currentImageSourceNodeId, currentImageSourceOutputIndex];
                if (workflowToQueue['142']) workflowToQueue['142']['inputs']['mask'] = ['136', 0]; // Connect to an empty mask or default if needed
                if (workflowToQueue['143']) workflowToQueue['143']['inputs']['images'] = [currentImageSourceNodeId, currentImageSourceOutputIndex];
                if (workflowToQueue['144']) workflowToQueue['144']['inputs']['images'] = [currentImageSourceNodeId, currentImageSourceOutputIndex];
            }

            // Sharpening (Node 149) and Rembg (Node 157) are not in the current HTML/JS,
            // so we assume they are either not used or are handled by the workflow JSON directly.
            // If they were to be re-added to UI, their logic would go here.
            // For now, ensure the final save image bypasses them if they exist but are not explicitly wired.
            if (workflowToQueue['149']) { /* Add logic if sharpen is re-introduced */ }
            if (workflowToQueue['157']) { /* Add logic if rembg is re-introduced */ }
            
            // Ensure the main save path is correct if no other post-processing
            if (workflowToQueue['158']) workflowToQueue['158']['inputs']['images'] = [currentImageSourceNodeId, currentImageSourceOutputIndex];


        } else { // Workflow2 (default)
            currentImageSourceNodeId = '32'; // VAEDecode output
            currentImageSourceOutputIndex = 0;
            finalSaveImageNodeId = '165'; // Correctly set to 165
            // Ensure Rembg (157) in workflow2 is bypassed if not explicitly enabled
            // The provided workflow has 157 (Rembg) connected to 158 (PreviewImage)
            // and 165 (SaveImage) is connected to 32 (VAEDecode).
            // So, no changes needed here.
        }

        // Set the final SaveImage node's input
        if (workflowToQueue[finalSaveImageNodeId]) {
            // This is already correctly wired in your base_workflow2.json for node 165 to 32,0
            // We only need to ensure the PreviewImage (158) is correctly wired.
            // The provided base_workflow2.json shows 158 connected to 157 (Rembg).
            // If Rembg is not used, 158 should connect to 32.
            if (workflowToQueue['158']) {
                // If Rembg (157) is present and its output is used by 158, keep that.
                // Otherwise, connect 158 to the main VAEDecode output (32).
                if (workflowToQueue['157'] && workflowToQueue['158']['inputs']['images'][0] === '157') {
                    // Keep existing connection if Rembg is used
                } else {
                    workflowToQueue['158']['inputs']['images'] = ['32', 0];
                }
            }
        } else {
            console.warn(`Final SaveImage node (${finalSaveImageNodeId}) not found in workflow.`);
        }

        // --- Conditional Model & CLIP Wiring based on LoRAs ---
        let finalModelSourceNodeId;
        let finalModelSourceOutputIndex = 0; // Model output of loraStackApply
        let finalClipSourceNodeId;
        let finalClipSourceOutputIndex = 1; // CLIP output of loraStackApply

        if (upscaleEnabled) {
            finalModelSourceNodeId = '161';
            finalClipSourceNodeId = '161';
        } else {
            finalModelSourceNodeId = '164';
            finalClipSourceNodeId = '164';
        }

        // Check if the loraStackApply node actually exists in the current workflow.
        // If it doesn't, fall back to CheckpointLoaderSimple (Node 4).
        if (!workflowToQueue[finalModelSourceNodeId]) {
            console.warn(`LoRA Stack Apply node (${finalModelSourceNodeId}) not found in workflow. Falling back to CheckpointLoaderSimple (Node 4) for Model and CLIP.`);
            finalModelSourceNodeId = '4';
            finalModelSourceOutputIndex = 0; // Model output of CheckpointLoaderSimple
            finalClipSourceNodeId = '4';
            finalClipSourceOutputIndex = 1; // CLIP output of CheckpointLoaderSimple
        } else {
            console.log(`DEBUG: Using LoRA Stack Apply node (${finalModelSourceNodeId}) for Model and CLIP.`);
        }


        // Update KSampler's MODEL input (Node 3)
        if (workflowToQueue['3']) {
            workflowToQueue['3']['inputs']['model'] = [finalModelSourceNodeId, finalModelSourceOutputIndex];
        } else {
            console.warn("Node 3 (KSampler) not found in workflow for MODEL input.");
        }
        // Update KSampler's MODEL input (Node 31, if upscale)
        if (upscaleEnabled && workflowToQueue['31']) {
            workflowToQueue['31']['inputs']['model'] = [finalModelSourceNodeId, finalModelSourceOutputIndex];
        } else if (upscaleEnabled) {
             console.warn("Node 31 (Upscale KSampler) not found in workflow for MODEL input.");
        }

        // Update CLIP inputs for text encoding nodes (7 and 11)
        if (workflowToQueue['7']) {
            workflowToQueue['7']['inputs']['clip'] = [finalClipSourceNodeId, finalClipSourceOutputIndex];
        } else {
            console.warn("Node 7 (CLIPTextEncode) not found in workflow for CLIP input.");
        }
        if (workflowToQueue['11']) {
            workflowToQueue['11']['inputs']['clip'] = [finalClipSourceNodeId, finalClipSourceOutputIndex];
        } else {
            console.warn("Node 11 (Text to Conditioning) not found in workflow for CLIP input.");
        }


        // --- Send Prompt ---
        console.log('🚀 Sending Updated Workflow:', JSON.stringify(workflowToQueue, null, 2)); // Log full workflow JSON

        const data = { prompt: workflowToQueue, client_id: clientId };

        try {
            const response = await fetch(`${comfyUiBaseUrl}/prompt`, { // Use dynamic base URL
                method: 'POST',
                cache: 'no-cache',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            if (!response.ok) {
                const errorData = await response.json();
                console.error("Prompt queue failed:", errorData);
                showMessageBox(`Failed to queue prompt: ${errorData.error || response.statusText}`, 'error');
                updateProgress(0, 0); // Reset progress on error
            }
        } catch (error) {
            console.error("Network error queuing prompt:", error);
            showMessageBox(`Network error: ${error.message}. Ensure ComfyUI is running and CORS is configured.`, 'error');
            updateProgress(0, 0); // Reset progress on error
        }
    }

    // --- Local Storage for LoRAs ---
    function saveLorasToLocalStorage() {
        const loras = [];
        loraFieldsContainer.querySelectorAll('.lora-field-row').forEach(row => {
            const select = row.querySelector('.lora-select');
            const weight = row.querySelector('input[type="range"]');
            if (select && weight) {
                loras.push({ name: select.value, weight: parseFloat(weight.value) });
            }
        });
        localStorage.setItem('savedLoras', JSON.stringify(loras));
    }

    function loadLorasFromLocalStorage() {
        const savedLoras = localStorage.getItem('savedLoras');
        if (savedLoras) {
            const loras = JSON.parse(savedLoras);
            // Clear existing dynamic LoRA fields before loading saved ones
            loraFieldsContainer.innerHTML = ''; 
            loraCounter = 0; // Reset counter
            loras.forEach(lora => {
                // Sanitize lora.name: if it's empty or not in availableLoras, default to "None"
                const sanitizedLoraName = (lora.name && availableLoras.includes(lora.name)) ? lora.name : "None";
                addLoraField(sanitizedLoraName, lora.weight);
            });
        }
        checkNoLorasMessage();
    }


    // --- Event Listeners ---
    generateImageButton.addEventListener('click', queuePromptWithInputs);
    
    randomSeedButton.addEventListener('click', () => {
        seedElement.value = Math.floor(Math.random() * 9999999999999);
    });
    
    autoRandomSeedButton.addEventListener('click', () => {
        autoRandomSeedEnabled = !autoRandomSeedEnabled;
        autoRandomSeedButton.classList.toggle('active', autoRandomSeedEnabled);
        localStorage.setItem('autoRandomSeedEnabled', autoRandomSeedEnabled); // Save state
    });

    // ComfyUI Connect Button Listener
    connectComfyUiButton.addEventListener('click', connectToComfyUI);

    // Upscale Toggle Listener
    upscaleToggle.addEventListener('change', async () => {
        upscaleEnabled = upscaleToggle.checked; // Get checked state
        localStorage.setItem('upscaleEnabled', upscaleEnabled); // Save state
        
        // When upscale toggle changes, load the appropriate workflow
        const workflowPath = upscaleEnabled ? '/comfygen/js/base_workflow.json' : '/comfygen/js/base_workflow2.json';
        await loadWorkflow(workflowPath);
        // updateResolutionUI will be called by loadWorkflow
    });

    // Face Detailer Toggle Listener
    faceDetailerToggle.addEventListener('change', () => {
        faceDetailerEnabled = faceDetailerToggle.checked;
        localStorage.setItem('faceDetailerEnabled', faceDetailerEnabled); // Save state
        // The visibility of the settings panel is handled by the DOMContentLoaded listener
        // and the updateFaceDetailerSettingsVisibility function in the HTML script block.
    });

    addLoraButton.addEventListener('click', () => addLoraField());

    // --- Initial Setup ---
    document.addEventListener('DOMContentLoaded', async () => {
        // Load saved ComfyUI address and attempt to connect
        const savedComfyUiAddress = localStorage.getItem('comfyUiAddress');
        if (savedComfyUiAddress) {
            comfyUiAddressInput.value = savedComfyUiAddress;
            await connectToComfyUI(); // Attempt auto-connect
        } else {
            // If no saved address, ensure controls are disabled and status is clear
            setControlsEnabled(false);
            comfyUiAddressInput.disabled = false;
            connectComfyUiButton.disabled = false;
            connectionStatusText.textContent = 'Enter ComfyUI Address';
            connectionStatusText.style.color = 'gray';
        }

        // Load other settings from local storage
        const savedUpscaleState = localStorage.getItem('upscaleEnabled');
        if (savedUpscaleState !== null) {
            upscaleEnabled = (savedUpscaleState === 'true');
            upscaleToggle.checked = upscaleEnabled;
        }

        const savedFaceDetailerState = localStorage.getItem('faceDetailerEnabled');
        if (savedFaceDetailerState !== null) {
            faceDetailerEnabled = (savedFaceDetailerState === 'true');
            faceDetailerToggle.checked = faceDetailerEnabled;
        }

        // Load initial workflow based on upscaleEnabled state
        const initialWorkflowPath = upscaleEnabled ? '/comfygen/js/base_workflow.json' : '/comfygen/js/base_workflow2.json';
        await loadWorkflow(initialWorkflowPath);
        
        // Load LoRAs from local storage (after workflow is loaded and availableLoras is populated)
        // This call is now placed after loadWorkflow to ensure availableLoras is populated.
        loadLorasFromLocalStorage();

        const savedAutoSeedState = localStorage.getItem('autoRandomSeedEnabled');
        if (savedAutoSeedState !== null) {
            autoRandomSeedEnabled = (savedAutoSeedState === 'true');
            autoRandomSeedButton.classList.toggle('active', autoRandomSeedEnabled);
        }

        // Pre-fill prompts if not already saved
        if (localStorage.getItem('negativePrompt') === null) {
            negativePromptElement.value = "(low quality, worst quality:1.4), (monochrome, grayscale:1.2), bad anatomy, bad hands, mutation, deformed, blurry, watermark, text, error, cropped, out of frame, jpeg artifacts, extra limbs, ugly, fat, obese";
        }
        if (localStorage.getItem('qualityTags') === null) {
            qualityTagsElement.value = "(masterpiece, best quality, ultra-detailed, 8k), incredibly_absurdres, highres";
        }

        updateProgress(0, 0); // Initialize progress bar and text
        checkNoLorasMessage(); // Check if "No LoRAs" message should be shown initially
    });

    // Function to update LoRA inputs (called on change/input for LoRA select/range)
    function updateLoraInputs() {
        const loraData = [];
        loraFieldsContainer.querySelectorAll('.lora-field-row').forEach((row, index) => {
            const loraSelect = row.querySelector('.lora-select');
            const loraWeightInput = row.querySelector('input[type="range"]');
            if (loraSelect && loraWeightInput) {
                loraData.push({
                    name: loraSelect.value,
                    weight: parseFloat(loraWeightInput.value)
                });
            }
        });
        console.log("Current LoRA selections:", loraData);
        saveLorasToLocalStorage(); // Save after any LoRA input change
    }

})();

// Keyframe animation for the custom message box (add this to comfygen.css)
// @keyframes fadeInOut {
//     0% { opacity: 0; transform: translate(-50%, -60%); }
//     10% { opacity: 1; transform: translate(-50%, -50%); }
//     90% { opacity: 1; transform: translate(-50%, -50%); }
//     100% { opacity: 0; transform: translate(-50%, -60%); }
