/**
 * @NApiVersion 2.1
 * @NScriptType ClientScript
 * @NModuleScope SameAccount
 */
define(['N/url', 'N/ui/dialog'], (url, dialog) => {

    const STEPS = {
        SELECT: 'select',
        ACTION: 'action'
    };

    const ACTIONS = {
        EXTEND: 'EXTEND'
    };

    /**
     * Initializes UI state when the Suitelet page loads.
     * @param {Object} context
     */
    const pageInit = (context) => {
        const rec = context.currentRecord;
        const step = rec.getValue({ fieldId: 'custpage_step' });

        if (step === STEPS.ACTION) {
            updateActionPageUi(rec);
        }
    };

    /**
     * Handles cascading dropdowns on Page 1 and dynamic End Date / Submit visibility on Page 2.
     * @param {Object} context
     */
    const fieldChanged = (context) => {
        const rec = context.currentRecord;
        const fieldId = context.fieldId;
        const step = rec.getValue({ fieldId: 'custpage_step' });

        if (step === STEPS.SELECT) {
            if (fieldId === 'custpage_customer') {
                const customerId = rec.getValue({ fieldId: 'custpage_customer' });
                reloadSuitelet({ step: STEPS.SELECT, customer: customerId || '' });
            } else if (fieldId === 'custpage_contract') {
                const customerId = rec.getValue({ fieldId: 'custpage_customer' });
                const contractId = rec.getValue({ fieldId: 'custpage_contract' });
                reloadSuitelet({
                    step: STEPS.SELECT,
                    customer: customerId || '',
                    contract: contractId || ''
                });
            }
        } else if (step === STEPS.ACTION) {
            if (fieldId === 'custpage_action_type' || fieldId === 'custpage_end_date') {
                updateActionPageUi(rec);
            } else if (fieldId === 'custpage_select_all_services') {
                const isChecked = rec.getValue({ fieldId: 'custpage_select_all_services' });
                const servicesField = rec.getField({ fieldId: 'custpage_services' });
                if (servicesField) {
                    const options = servicesField.getSelectOptions() || [];
                    const allValues = options.map((opt) => opt.value).filter(Boolean);
                    rec.setValue({
                        fieldId: 'custpage_services',
                        value: isChecked ? allValues : [],
                        ignoreFieldChange: true
                    });
                }
                updateActionPageUi(rec);
            } else if (fieldId === 'custpage_services') {
                const servicesField = rec.getField({ fieldId: 'custpage_services' });
                if (servicesField) {
                    const options = servicesField.getSelectOptions() || [];
                    const allValues = options.map((opt) => opt.value).filter(Boolean);
                    const selected = rec.getValue({ fieldId: 'custpage_services' }) || [];
                    const isAll = allValues.length > 0 && selected.length === allValues.length;
                    const currentSelectAll = rec.getValue({ fieldId: 'custpage_select_all_services' });
                    if (isAll !== currentSelectAll) {
                        rec.setValue({
                            fieldId: 'custpage_select_all_services',
                            value: isAll,
                            ignoreFieldChange: true
                        });
                    }
                }
                updateActionPageUi(rec);
            }
        }
    };

    /**
     * Validates form inputs before submitting Page 1 or Page 2.
     * @param {Object} context
     * @returns {boolean}
     */
    const saveRecord = (context) => {
        const rec = context.currentRecord;
        const step = rec.getValue({ fieldId: 'custpage_step' });

        if (step === STEPS.SELECT) {
            const customerId = rec.getValue({ fieldId: 'custpage_customer' });
            const contractId = rec.getValue({ fieldId: 'custpage_contract' });

            if (!customerId || !contractId) {
                dialog.alert({
                    title: 'Missing Selection',
                    message: 'Please select both a Customer and a Contract.'
                });
                return false;
            }

            const lineCount = rec.getLineCount({ sublistId: 'custpage_site_sublist' });
            let hasSelectedSite = false;
            for (let i = 0; i < lineCount; i++) {
                const isChecked = rec.getSublistValue({
                    sublistId: 'custpage_site_sublist',
                    fieldId: 'custpage_site_select',
                    line: i
                });
                if (isChecked === true || isChecked === 'T') {
                    hasSelectedSite = true;
                    break;
                }
            }

            if (!hasSelectedSite) {
                dialog.alert({
                    title: 'No Site Mapping Selected',
                    message: 'Please select at least one Site Mapping record.'
                });
                return false;
            }
            return true;
        }

        if (step === STEPS.ACTION) {
            const actionType = rec.getValue({ fieldId: 'custpage_action_type' });
            if (!actionType) {
                dialog.alert({
                    title: 'Missing Action',
                    message: 'Please select a Type of Action.'
                });
                return false;
            }

            if (actionType === ACTIONS.EXTEND) {
                const endDate = rec.getValue({ fieldId: 'custpage_end_date' });
                if (!endDate) {
                    dialog.alert({
                        title: 'Missing End Date',
                        message: 'Please enter an End Date before submitting.'
                    });
                    return false;
                }

                const services = rec.getValue({ fieldId: 'custpage_services' });
                const hasServices = Array.isArray(services) ? services.length > 0 : Boolean(services);
                if (!hasServices) {
                    dialog.alert({
                        title: 'Missing Service',
                        message: 'Please select at least one Service before submitting.'
                    });
                    return false;
                }
            }
            return true;
        }

        return true;
    };

    /**
     * Shows/hides End Date, Service multiselect, and Submit button on Page 2 based on Type of Action and End Date.
     * @param {Object} rec
     */
    const updateActionPageUi = (rec) => {
        const actionType = rec.getValue({ fieldId: 'custpage_action_type' });
        const endDateField = rec.getField({ fieldId: 'custpage_end_date' });
        const selectAllField = rec.getField({ fieldId: 'custpage_select_all_services' });
        const servicesField = rec.getField({ fieldId: 'custpage_services' });
        const isExtend = actionType === ACTIONS.EXTEND;

        if (endDateField) {
            endDateField.isDisplay = isExtend;
            endDateField.isMandatory = isExtend;
        }

        if (selectAllField) {
            selectAllField.isDisplay = isExtend;
        }

        if (servicesField) {
            servicesField.isDisplay = isExtend;
            servicesField.isMandatory = isExtend;
        }

        if (!isExtend) {
            if (rec.getValue({ fieldId: 'custpage_end_date' })) {
                rec.setValue({
                    fieldId: 'custpage_end_date',
                    value: '',
                    ignoreFieldChange: true
                });
            }
            if (rec.getValue({ fieldId: 'custpage_select_all_services' })) {
                rec.setValue({
                    fieldId: 'custpage_select_all_services',
                    value: false,
                    ignoreFieldChange: true
                });
            }
            const currentServices = rec.getValue({ fieldId: 'custpage_services' });
            if (currentServices && currentServices.length > 0) {
                rec.setValue({
                    fieldId: 'custpage_services',
                    value: [],
                    ignoreFieldChange: true
                });
            }
        }

        const hasEndDate = Boolean(rec.getValue({ fieldId: 'custpage_end_date' }));
        const currentServices = rec.getValue({ fieldId: 'custpage_services' });
        const hasServices = Array.isArray(currentServices) ? currentServices.length > 0 : Boolean(currentServices);
        const showSubmit = isExtend ? (hasEndDate && hasServices) : Boolean(actionType);
        toggleSubmitButtons(showSubmit);
    };

    /**
     * Toggles visibility of NetSuite's primary and secondary Suitelet submit buttons.
     * @param {boolean} visible
     */
    const toggleSubmitButtons = (visible) => {
        const displayVal = visible ? '' : 'none';
        const btnIds = ['submitter', 'secondarysubmitter'];
        btnIds.forEach((id) => {
            const btn = document.getElementById(id);
            if (btn) {
                btn.style.display = displayVal;
            }
            // Also hide/show the wrapping table cell/span in NetSuite Redwood/Classic UI
            if (btn && btn.parentElement && btn.parentElement.parentElement) {
                const wrapper = btn.closest('.uir-button');
                if (wrapper) {
                    wrapper.style.display = displayVal;
                }
            }
        });
    };

    /**
     * Reloads the current Suitelet with updated query parameters without triggering unsaved-changes prompt.
     * @param {Object} params
     */
    const reloadSuitelet = (params) => {
        const urlParams = new URLSearchParams(window.location.search);
        const scriptId = urlParams.get('script');
        const deployId = urlParams.get('deploy');

        const suiteletUrl = url.resolveScript({
            scriptId: scriptId,
            deploymentId: deployId,
            params: params
        });

        window.onbeforeunload = null;
        window.location.href = suiteletUrl;
    };

    return {
        pageInit,
        fieldChanged,
        saveRecord
    };
});
