/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 * @NModuleScope SameAccount
 */
define([
    'N/ui/serverWidget',
    'N/search',
    'N/redirect',
    'N/url',
    'N/format',
    'N/runtime',
    'N/task',
    'N/log'
], (serverWidget, search, redirect, url, format, runtime, task, log) => {

    /**
     * Centralized configuration for custom record & field script IDs.
     * Update the placeholder IDs below to match your NetSuite account.
     */
    const CONFIG = {
        CLIENT_SCRIPT_PATH: './uds_cs_contract_action.js',
        MR_SCRIPT: {
            SCRIPT_ID: 'customscript_uds_mr_contract_extend',
            DEPLOYMENT_ID: 'customdeploy_uds_mr_contract_extend'
        },
        CONTRACT: {
            TYPE: 'customsale_uds_contract',
            CUSTOMER_FIELD: 'entity'
        },
        SITE_MAPPING: {
            TYPE: 'customrecord_uds_site_mapping',        // TODO: Verify Site Mapping record script ID
            CONTRACT_FIELD: 'custrecord_sm_contract_ref',     // TODO: Verify Contract link field ID on Site Mapping
            NAME_FIELD: 'custrecord_sm_site_information_ref'                            // TODO: Verify Site name/display field ID
        },
        REVENUE_SHEET: {
            TYPE: 'customrecord_uds_revenue_sheet',       // TODO: Verify Revenue Sheet record script ID
            CONTRACT_FIELD: 'custrecord_uds_rs_contract_ref',     // TODO: Verify Contract link field ID
            SITE_FIELD: 'custrecord_uds_rs_site',     // TODO: Optional - Site Mapping link field ID (leave '' if linked only to Contract)
            SERVICE_FIELD: 'custrecord_uds_rs_item_grp',
            VALID_FROM_FIELD: 'custrecord_uds_rs_valid_from', // TODO: Verify Valid From date field ID
            VALID_TILL_FIELD: 'custrecord_uds_rs_valid_till'  // TODO: Verify Valid Till date field ID
        },
        INTERNAL_BUDGET: {
            TYPE: 'customrecord_uds_cost_sheet',     // TODO: Verify Internal Budget record script ID
            CONTRACT_FIELD: 'custrecord_uds_cs_contract_ref',     // TODO: Verify Contract link field ID
            SITE_FIELD: 'custrecord_uds_cs_site',     // TODO: Optional - Site Mapping link field ID (leave '' if linked only to Contract)
            VALID_FROM_FIELD: 'custrecord_uds_cs_valid_from', // TODO: Verify Valid From date field ID
            VALID_TILL_FIELD: 'custrecord_uds_cs_valid_till'  // TODO: Verify Valid Till date field ID
        }
    };

    const STEPS = {
        SELECT: 'select',
        ACTION: 'action',
        LOADER: 'loader'
    };

    const ACTIONS = {
        EXTEND: 'EXTEND',
        REVISION: 'REVISION',
        NAME_CHANGE: 'NAME_CHANGE'
    };

    /**
     * Checks for JS null/empty as well as NetSuite ScriptNullObjectAdapter values.
     * @param {*} val
     * @returns {boolean}
     */
    const isNullOrEmpty = (val) => {
        if (val === null || val === undefined || val === '') {
            return true;
        }
        return String(val).indexOf('ScriptNullObjectAdapter') !== -1;
    };

    /**
     * Entry point for Suitelet GET and POST requests.
     * @param {Object} context
     */
    const onRequest = (context) => {
        try {
            const action = context.request.parameters.action;
            if (action === 'checkStatus') {
                handleCheckStatus(context);
                return;
            }

            if (context.request.method === 'GET') {
                const step = context.request.parameters.step || STEPS.SELECT;
                if (step === STEPS.ACTION) {
                    renderActionPage(context);
                } else if (step === STEPS.LOADER) {
                    renderLoaderPage(context);
                } else {
                    renderSelectionPage(context);
                }
            } else {
                const step = context.request.parameters.custpage_step || STEPS.SELECT;
                if (step === STEPS.ACTION) {
                    handleActionSubmit(context);
                } else {
                    handleSelectionSubmit(context);
                }
            }
        } catch (e) {
            log.error({ title: 'Suitelet Error', details: e });
            const errMsg = (e && e.message) ? `${e.name || 'Error'}: ${e.message}` : String(e);
            renderResultPage(context, 'Error', `<p style="color:#c00;"><b>Failed to process request:</b> ${errMsg}</p>`);
        }
    };

    /**
     * Page 1: Customer -> Contract -> Site Mapping (with Checkboxes).
     * @param {Object} context
     */
    const renderSelectionPage = (context) => {
        const params = context.request.parameters;
        const selectedCustomer = params.customer || '';
        const selectedContract = params.contract || '';

        const form = serverWidget.createForm({
            title: 'Contract Lifecycle Management - Selection'
        });
        form.clientScriptModulePath = CONFIG.CLIENT_SCRIPT_PATH;

        const stepField = form.addField({
            id: 'custpage_step',
            type: serverWidget.FieldType.TEXT,
            label: 'Step'
        });
        stepField.defaultValue = STEPS.SELECT;
        stepField.updateDisplayType({ displayType: serverWidget.FieldDisplayType.HIDDEN });

        const customerField = form.addField({
            id: 'custpage_customer',
            type: serverWidget.FieldType.SELECT,
            label: 'Customer',
            source: 'customer'
        });
        customerField.isMandatory = true;
        if (selectedCustomer) {
            customerField.defaultValue = selectedCustomer;
        }

        const contractField = form.addField({
            id: 'custpage_contract',
            type: serverWidget.FieldType.SELECT,
            label: 'Contract'
        });
        contractField.isMandatory = true;
        contractField.addSelectOption({ value: '', text: '' });

        if (selectedCustomer) {
            const contracts = getContractsByCustomer(selectedCustomer);
            contracts.forEach((c) => {
                contractField.addSelectOption({
                    value: c.id,
                    text: c.label,
                    isSelected: c.id === selectedContract
                });
            });
        }

        // Site Mapping Sublist
        const siteSublist = form.addSublist({
            id: 'custpage_site_sublist',
            type: serverWidget.SublistType.LIST,
            label: 'Site Mapping'
        });
        siteSublist.addMarkAllButtons();

        siteSublist.addField({
            id: 'custpage_site_select',
            type: serverWidget.FieldType.CHECKBOX,
            label: 'Select'
        });

        const siteIdCol = siteSublist.addField({
            id: 'custpage_site_id',
            type: serverWidget.FieldType.TEXT,
            label: 'Internal ID'
        });
        siteIdCol.updateDisplayType({ displayType: serverWidget.FieldDisplayType.HIDDEN });

        siteSublist.addField({
            id: 'custpage_site_name',
            type: serverWidget.FieldType.TEXT,
            label: 'Site Name'
        });

        if (selectedContract) {
            const siteMappings = getSiteMappingsByContract(selectedContract);
            siteMappings.forEach((site, idx) => {
                siteSublist.setSublistValue({
                    id: 'custpage_site_id',
                    line: idx,
                    value: site.id
                });
                siteSublist.setSublistValue({
                    id: 'custpage_site_name',
                    line: idx,
                    value: site.name
                });
            });
        }

        form.addSubmitButton({ label: 'Submit' });
        context.response.writePage(form);
    };

    /**
     * Handles Page 1 submit and redirects to Page 2 with selected parameters.
     * @param {Object} context
     */
    const handleSelectionSubmit = (context) => {
        const req = context.request;
        const customerId = req.parameters.custpage_customer || '';
        const contractId = req.parameters.custpage_contract || '';
        const lineCount = req.getLineCount({ group: 'custpage_site_sublist' });

        const selectedSites = [];
        for (let i = 0; i < lineCount; i++) {
            const isChecked = req.getSublistValue({
                group: 'custpage_site_sublist',
                name: 'custpage_site_select',
                line: i
            });
            if (isChecked === 'T' || isChecked === true) {
                const siteId = req.getSublistValue({
                    group: 'custpage_site_sublist',
                    name: 'custpage_site_id',
                    line: i
                });
                if (siteId) {
                    selectedSites.push(siteId);
                }
            }
        }

        const scriptObj = runtime.getCurrentScript();
        redirect.toSuitelet({
            scriptId: scriptObj.id,
            deploymentId: scriptObj.deploymentId,
            parameters: {
                step: STEPS.ACTION,
                customer: customerId,
                contract: contractId,
                sites: selectedSites.join(',')
            }
        });
    };

    /**
     * Page 2: Type of Action (EXTEND / REVISION / NAME CHANGE) + End Date + Submit.
     * @param {Object} context
     */
    const renderActionPage = (context) => {
        const params = context.request.parameters;
        const customerId = params.customer || '';
        const contractId = params.contract || '';
        const siteIds = params.sites || '';

        const form = serverWidget.createForm({
            title: 'Contract Lifecycle Management - Action'
        });
        form.clientScriptModulePath = CONFIG.CLIENT_SCRIPT_PATH;

        addHiddenField(form, 'custpage_step', STEPS.ACTION);
        addHiddenField(form, 'custpage_customer_id', customerId);
        addHiddenField(form, 'custpage_contract_id', contractId);
        addHiddenField(form, 'custpage_site_ids', siteIds);

        // Read-only context summary
        const summaryContract = form.addField({
            id: 'custpage_summary_contract',
            type: serverWidget.FieldType.SELECT,
            label: 'Contract',
            source: CONFIG.CONTRACT.TYPE
        });
        summaryContract.defaultValue = contractId;
        summaryContract.updateDisplayType({ displayType: serverWidget.FieldDisplayType.INLINE });

        const summarySites = form.addField({
            id: 'custpage_summary_sites',
            type: serverWidget.FieldType.TEXT,
            label: 'Selected Site Mappings'
        });
        summarySites.defaultValue = siteIds ? `${siteIds.split(',').length} selected (${siteIds})` : 'None';
        summarySites.updateDisplayType({ displayType: serverWidget.FieldDisplayType.INLINE });

        // Type of Action Dropdown
        const actionField = form.addField({
            id: 'custpage_action_type',
            type: serverWidget.FieldType.SELECT,
            label: 'Type of Action'
        });
        actionField.isMandatory = true;
        actionField.addSelectOption({ value: '', text: '' });
        actionField.addSelectOption({ value: ACTIONS.EXTEND, text: '1. EXTEND' });
        actionField.addSelectOption({ value: ACTIONS.REVISION, text: '2. REVISION' });
        actionField.addSelectOption({ value: ACTIONS.NAME_CHANGE, text: '3. NAME CHANGE' });

        // End Date (rendered as NORMAL so Client Script can toggle isDisplay dynamically)
        form.addField({
            id: 'custpage_end_date',
            type: serverWidget.FieldType.DATE,
            label: 'End Date'
        });

        // Select All Services Checkbox
        form.addField({
            id: 'custpage_select_all_services',
            type: serverWidget.FieldType.CHECKBOX,
            label: 'Select All Services'
        });

        // Service Multiselect (populated from Revenue Sheet custrecord_uds_rs_item_grp, toggled by Client Script on EXTEND)
        const serviceField = form.addField({
            id: 'custpage_services',
            type: serverWidget.FieldType.MULTISELECT,
            label: 'Service'
        });
        if (contractId) {
            const services = getServicesByContract(contractId);
            services.forEach((svc) => {
                serviceField.addSelectOption({
                    value: svc.id,
                    text: svc.label
                });
            });
        }

        // Submit button (visibility controlled by Client Script after End Date is entered)
        form.addSubmitButton({ label: 'Submit' });

        context.response.writePage(form);
    };

    /**
     * Handles Page 2 submit: for EXTEND, queues the Map/Reduce script and redirects to the end-user loader page.
     * @param {Object} context
     */
    const handleActionSubmit = (context) => {
        const params = context.request.parameters;
        const actionType = params.custpage_action_type || '';
        const contractId = params.custpage_contract_id || params.contract || '';
        const siteIdsRaw = params.custpage_site_ids || params.sites || '';
        const siteIds = siteIdsRaw ? siteIdsRaw.split(',').filter(Boolean) : [];
        const endDateStr = params.custpage_end_date || '';

        if (actionType !== ACTIONS.EXTEND) {
            renderResultPage(context, 'Action Recorded', `Selected action "${actionType}" is not yet configured for automated record copying.`);
            return;
        }

        if (isNullOrEmpty(contractId)) {
            renderResultPage(context, 'Missing Contract', '<p style="color:#c00;">Contract ID is missing. Please start over from the selection page.</p>');
            return;
        }

        if (isNullOrEmpty(endDateStr)) {
            renderResultPage(context, 'Missing End Date', '<p style="color:#c00;">End Date is required when extending a contract.</p>');
            return;
        }

        const parsedEndDate = format.parse({
            value: endDateStr,
            type: format.Type.DATE
        });

        if (isNullOrEmpty(parsedEndDate)) {
            renderResultPage(context, 'Invalid End Date', `<p style="color:#c00;">Could not parse End Date: ${endDateStr}</p>`);
            return;
        }

        const endDateIso = toIsoDateString(parsedEndDate);
        const servicesRaw = params.custpage_services || '';
        const selectedServices = servicesRaw ? servicesRaw.split(/[\u0005,]/).filter(Boolean) : [];

        if (selectedServices.length === 0) {
            renderResultPage(context, 'Missing Service', '<p style="color:#c00;">Please select at least one Service before submitting.</p>');
            return;
        }

        log.audit({
            title: 'Queueing Contract Extension Task',
            details: {
                contractId: contractId,
                endDateIso: endDateIso,
                services: selectedServices.join(',')
            }
        });

        const mrTask = task.create({
            taskType: task.TaskType.MAP_REDUCE,
            scriptId: CONFIG.MR_SCRIPT.SCRIPT_ID,
            deploymentId: CONFIG.MR_SCRIPT.DEPLOYMENT_ID,
            params: {
                custscript_uds_ext_contract_id: contractId,
                custscript_uds_ext_end_date: endDateIso,
                custscript_uds_ext_services: selectedServices.join(',')
            }
        });
        const taskId = mrTask.submit();

        const scriptObj = runtime.getCurrentScript();
        redirect.toSuitelet({
            scriptId: scriptObj.id,
            deploymentId: scriptObj.deploymentId,
            parameters: {
                step: STEPS.LOADER,
                taskId: taskId,
                contract: contractId,
                endDate: endDateStr
            }
        });
    };

    /**
     * Checks background Map/Reduce task status and returns JSON for the loader's AJAX poller.
     * @param {Object} context
     */
    const handleCheckStatus = (context) => {
        const taskId = context.request.parameters.taskId;
        try {
            if (!taskId) {
                throw new Error('Task ID parameter is missing');
            }
            const taskStatus = task.checkStatus({ taskId: taskId });
            const percent = Math.min(Math.max(Math.round(taskStatus.getPercentageCompleted() || 0), 0), 100);
            context.response.setHeader({ name: 'Content-Type', value: 'application/json' });
            context.response.write(JSON.stringify({
                success: true,
                status: taskStatus.status,
                stage: taskStatus.stage || 'INITIALIZING',
                percent: percent
            }));
        } catch (e) {
            log.error({ title: 'Error checking task status', details: e });
            context.response.setHeader({ name: 'Content-Type', value: 'application/json' });
            context.response.write(JSON.stringify({
                success: false,
                status: 'ERROR',
                error: e.message || String(e)
            }));
        }
    };

    /**
     * End-user loader page: displays progress bar and polling animation instead of dev view.
     * @param {Object} context
     */
    const renderLoaderPage = (context) => {
        const params = context.request.parameters;
        const taskId = params.taskId || '';
        const contractId = params.contract || '';
        const endDateStr = params.endDate || '';

        const scriptObj = runtime.getCurrentScript();
        const checkStatusUrl = url.resolveScript({
            scriptId: scriptObj.id,
            deploymentId: scriptObj.deploymentId,
            params: {
                action: 'checkStatus',
                taskId: taskId
            }
        });

        const newSelectionUrl = url.resolveScript({
            scriptId: scriptObj.id,
            deploymentId: scriptObj.deploymentId,
            params: {
                step: STEPS.SELECT
            }
        });

        const contractUrl = `/app/accounting/transactions/transaction.nl?id=${contractId}`;

        const form = serverWidget.createForm({
            title: 'Contract Lifecycle Management - Extension Status'
        });

        const htmlField = form.addField({
            id: 'custpage_loader_html',
            type: serverWidget.FieldType.INLINEHTML,
            label: 'Status'
        });

        htmlField.defaultValue = `
<style>
@keyframes clm-spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
.clm-loader-card {
    max-width: 620px;
    margin: 40px auto;
    background: #ffffff;
    border-radius: 12px;
    box-shadow: 0 4px 20px rgba(0,0,0,0.06);
    padding: 40px 30px;
    text-align: center;
    border: 1px solid #e5e9f0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
}
.clm-spinner {
    display: inline-block;
    width: 56px;
    height: 56px;
    border: 5px solid #edf2f7;
    border-top-color: #0070d2;
    border-radius: 50%;
    animation: clm-spin 1s linear infinite;
}
.clm-badge-icon {
    width: 60px;
    height: 60px;
    margin: 0 auto;
    border-radius: 50%;
    line-height: 60px;
    font-size: 32px;
    font-weight: bold;
}
.clm-btn {
    padding: 10px 22px;
    border-radius: 6px;
    text-decoration: none;
    font-size: 14px;
    font-weight: 500;
    display: inline-block;
    cursor: pointer;
}
.clm-btn-primary { background: #0070d2; color: #ffffff !important; border: 1px solid #0070d2; }
.clm-btn-primary:hover { background: #005fb2; }
.clm-btn-secondary { background: #f8fafc; color: #334155 !important; border: 1px solid #cbd5e1; }
.clm-btn-secondary:hover { background: #f1f5f9; }
</style>

<div class="clm-loader-card">
    <div id="icon-container" style="margin-bottom: 20px;">
        <div id="spinner" class="clm-spinner"></div>
        <div id="success-icon" class="clm-badge-icon" style="display:none; background:#dcfce7; color:#15803d;">&#10003;</div>
        <div id="error-icon" class="clm-badge-icon" style="display:none; background:#fee2e2; color:#b91c1c;">&#10007;</div>
    </div>

    <h2 id="status-title" style="margin: 0 0 10px 0; color: #0f172a; font-size: 20px; font-weight: 600;">
        Extending Contract...
    </h2>
    <p id="status-desc" style="margin: 0 0 24px 0; color: #64748b; font-size: 14px; line-height: 1.5;">
        Please wait while active Revenue Sheet and Internal Budget records are being copied with the new validity dates.
    </p>

    <!-- Progress bar -->
    <div style="background: #e2e8f0; border-radius: 8px; height: 12px; overflow: hidden; margin-bottom: 12px;">
        <div id="progress-bar" style="background: #0070d2; height: 100%; width: 5%; border-radius: 8px; transition: width 0.4s ease;"></div>
    </div>

    <div style="display: flex; justify-content: space-between; font-size: 13px; color: #64748b; margin-bottom: 24px;">
        <span id="stage-label">Initializing...</span>
        <span id="percent-label">0%</span>
    </div>

    <!-- Buttons shown on complete / fail -->
    <div id="action-buttons" style="display:none; margin-top: 24px; gap: 12px; justify-content: center;">
        <a id="btn-view-contract" href="${contractUrl}" target="_blank" class="clm-btn clm-btn-primary">View Contract</a>
        <a id="btn-new-selection" href="${newSelectionUrl}" class="clm-btn clm-btn-secondary">Extend Another Contract</a>
    </div>
</div>

<script>
(function() {
    var checkUrl = '${checkStatusUrl}';
    var isDone = false;

    var stageNames = {
        'INITIALIZING': 'Preparing extension...',
        'GET_INPUT': 'Finding active Revenue Sheet & Internal Budget records...',
        'MAP': 'Copying records and applying new validity dates...',
        'REDUCE': 'Processing...',
        'SUMMARIZE': 'Finalizing records...',
        'COMPLETE': 'Contract extension complete!'
    };

    function pollStatus() {
        if (isDone) return;
        fetch(checkUrl, { cache: 'no-store' })
            .then(function(res) { return res.json(); })
            .then(function(data) {
                if (!data || !data.success) {
                    showError(data ? data.error : 'Failed to retrieve task status.');
                    return;
                }

                var status = data.status;
                var stage = data.stage;
                var percent = data.percent || 0;

                var progressBar = document.getElementById('progress-bar');
                var percentLabel = document.getElementById('percent-label');
                var stageLabel = document.getElementById('stage-label');

                if (status === 'PENDING') {
                    progressBar.style.width = '10%';
                    percentLabel.textContent = '10%';
                    stageLabel.textContent = stageNames['INITIALIZING'];
                    setTimeout(pollStatus, 2000);
                } else if (status === 'PROCESSING') {
                    var displayPercent = Math.max(percent, 25);
                    progressBar.style.width = displayPercent + '%';
                    percentLabel.textContent = displayPercent + '%';
                    stageLabel.textContent = stageNames[stage] || 'Processing records...';
                    setTimeout(pollStatus, 2000);
                } else if (status === 'COMPLETE') {
                    isDone = true;
                    progressBar.style.width = '100%';
                    progressBar.style.background = '#15803d';
                    percentLabel.textContent = '100%';
                    stageLabel.textContent = stageNames['COMPLETE'];

                    document.getElementById('spinner').style.display = 'none';
                    document.getElementById('success-icon').style.display = 'block';
                    document.getElementById('status-title').textContent = 'Contract Extended Successfully!';
                    document.getElementById('status-desc').textContent = 'All active Revenue Sheet and Internal Budget records have been copied. Valid Till has been set to ${endDateStr}.';
                    document.getElementById('action-buttons').style.display = 'inline-flex';
                } else if (status === 'FAILED') {
                    showError('The background extension task failed. Please contact your NetSuite Administrator.');
                } else {
                    setTimeout(pollStatus, 2000);
                }
            })
            .catch(function(err) {
                console.error('CLM status poll error:', err);
                setTimeout(pollStatus, 3000);
            });
    }

    function showError(msg) {
        isDone = true;
        document.getElementById('spinner').style.display = 'none';
        document.getElementById('error-icon').style.display = 'block';
        document.getElementById('status-title').textContent = 'Extension Failed';
        document.getElementById('status-desc').textContent = msg;
        document.getElementById('progress-bar').style.background = '#b91c1c';
        document.getElementById('stage-label').textContent = 'Failed';
        document.getElementById('action-buttons').style.display = 'inline-flex';
    }

    setTimeout(pollStatus, 1500);
})();
</script>
`;

        context.response.writePage(form);
    };

    /**
     * Converts a Date object to YYYY-MM-DD so it is independent of user/system date format preferences.
     * @param {Date} dt
     * @returns {string}
     */
    const toIsoDateString = (dt) => {
        const y = dt.getFullYear();
        const m = String(dt.getMonth() + 1).padStart(2, '0');
        const d = String(dt.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    };

    /**
     * Searches active contracts for the given customer.
     * @param {string} customerId
     * @returns {Array<{id: string, label: string}>}
     */
    const getContractsByCustomer = (customerId) => {
        const results = [];
        const contractSearch = search.create({
            type: CONFIG.CONTRACT.TYPE,
            filters: [
                [CONFIG.CONTRACT.CUSTOMER_FIELD, 'anyof', customerId],
                'AND',
                ['mainline', 'is', 'T']
            ],
            columns: [
                search.createColumn({ name: 'tranid', sort: search.Sort.ASC }),
                search.createColumn({ name: 'trandate' })
            ]
        });

        contractSearch.run().each((res) => {
            const tranId = res.getValue({ name: 'tranid' }) || res.id;
            const tranDate = res.getValue({ name: 'trandate' });
            results.push({
                id: String(res.id),
                label: tranDate ? `${tranId} (${tranDate})` : String(tranId)
            });
            return true;
        });

        return results;
    };

    /**
     * Searches distinct Services (custrecord_uds_rs_item_grp) from Revenue Sheet records for the contract.
     * @param {string} contractId
     * @returns {Array<{id: string, label: string}>}
     */
    const getServicesByContract = (contractId) => {
        const results = [];
        const serviceCol = search.createColumn({
            name: CONFIG.REVENUE_SHEET.SERVICE_FIELD,
            summary: search.Summary.GROUP,
            sort: search.Sort.ASC
        });

        const activeFilters = [
            [CONFIG.REVENUE_SHEET.CONTRACT_FIELD, 'anyof', contractId],
            'AND',
            ['isinactive', 'is', 'F']
        ];
        if (CONFIG.REVENUE_SHEET.VALID_FROM_FIELD) {
            activeFilters.push('AND', [CONFIG.REVENUE_SHEET.VALID_FROM_FIELD, 'onorbefore', 'today']);
        }
        if (CONFIG.REVENUE_SHEET.VALID_TILL_FIELD) {
            activeFilters.push('AND', [CONFIG.REVENUE_SHEET.VALID_TILL_FIELD, 'onorafter', 'today']);
        }

        let svcSearch = search.create({
            type: CONFIG.REVENUE_SHEET.TYPE,
            filters: activeFilters,
            columns: [serviceCol]
        });

        svcSearch.run().each((res) => {
            const id = res.getValue(serviceCol);
            if (!isNullOrEmpty(id)) {
                const label = res.getText(serviceCol) || String(id);
                results.push({
                    id: String(id),
                    label: String(label)
                });
            }
            return true;
        });

        // Fallback: If no active services found, search all services for this contract
        if (results.length === 0) {
            svcSearch = search.create({
                type: CONFIG.REVENUE_SHEET.TYPE,
                filters: [
                    [CONFIG.REVENUE_SHEET.CONTRACT_FIELD, 'anyof', contractId],
                    'AND',
                    ['isinactive', 'is', 'F']
                ],
                columns: [serviceCol]
            });

            svcSearch.run().each((res) => {
                const id = res.getValue(serviceCol);
                if (!isNullOrEmpty(id)) {
                    const label = res.getText(serviceCol) || String(id);
                    results.push({
                        id: String(id),
                        label: String(label)
                    });
                }
                return true;
            });
        }

        return results;
    };

    /**
     * Searches active Site Mapping records linked to the given contract.
     * @param {string} contractId
     * @returns {Array<{id: string, name: string}>}
     */
    const getSiteMappingsByContract = (contractId) => {
        const results = [];
        const siteSearch = search.create({
            type: CONFIG.SITE_MAPPING.TYPE,
            filters: [
                [CONFIG.SITE_MAPPING.CONTRACT_FIELD, 'anyof', contractId],
                'AND',
                ['isinactive', 'is', 'F']
            ],
            columns: [
                search.createColumn({ name: CONFIG.SITE_MAPPING.NAME_FIELD, sort: search.Sort.ASC })
            ]
        });

        siteSearch.run().each((res) => {
            results.push({
                id: String(res.id),
                name: res.getText({ name: CONFIG.SITE_MAPPING.NAME_FIELD }) || `Site #${res.id}`
            });
            return true;
        });

        return results;
    };

    /**
     * Helper to add a hidden text field to a Suitelet form.
     */
    const addHiddenField = (form, id, value) => {
        const fld = form.addField({
            id: id,
            type: serverWidget.FieldType.TEXT,
            label: id
        });
        fld.defaultValue = value || '';
        fld.updateDisplayType({ displayType: serverWidget.FieldDisplayType.HIDDEN });
        return fld;
    };

    /**
     * Renders a simple confirmation/result page with a button to start over.
     */
    const renderResultPage = (context, title, htmlMessage) => {
        const form = serverWidget.createForm({ title: title });
        const msgField = form.addField({
            id: 'custpage_result_msg',
            type: serverWidget.FieldType.INLINEHTML,
            label: 'Result'
        });
        msgField.defaultValue = `<div style="font-size:13px; line-height:1.6;">${htmlMessage}</div>`;

        const scriptObj = runtime.getCurrentScript();
        const backUrl = `/app/site/hosting/scriptlet.nl?script=${scriptObj.id}&deploy=${scriptObj.deploymentId}`;
        form.addButton({
            id: 'custpage_back_btn',
            label: 'New Selection',
            functionName: `window.location.href='${backUrl}'`
        });

        context.response.writePage(form);
    };

    return { onRequest };
});
