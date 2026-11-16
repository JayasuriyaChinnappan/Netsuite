/**
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 * @NModuleScope SameAccount
 */
define([
    'N/search',
    'N/record',
    'N/format',
    'N/runtime',
    'N/log'
], (search, record, format, runtime, log) => {

    const PARAMS = {
        CONTRACT_ID: 'custscript_uds_ext_contract_id',
        END_DATE: 'custscript_uds_ext_end_date', // Expected format: YYYY-MM-DD
        SERVICES: 'custscript_uds_ext_services'  // Optional comma-separated Service (item group) IDs
    };

    const RECORD_CONFIGS = [
        {
            TYPE: 'customrecord_uds_revenue_sheet',
            CONTRACT_FIELD: 'custrecord_uds_rs_contract_ref',
            SERVICE_FIELD: 'custrecord_uds_rs_item_grp',
            VALID_FROM_FIELD: 'custrecord_uds_rs_valid_from',
            VALID_TILL_FIELD: 'custrecord_uds_rs_valid_till'
        },
        {
            TYPE: 'customrecord_uds_cost_sheet',
            CONTRACT_FIELD: 'custrecord_uds_cs_contract_ref',
            SERVICE_FIELD: '', // Optional: add Internal Budget service/item group field ID if it should also filter by Service
            VALID_FROM_FIELD: 'custrecord_uds_cs_valid_from',
            VALID_TILL_FIELD: 'custrecord_uds_cs_valid_till'
        }
    ];

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
     * Parses a YYYY-MM-DD string into a local Date object (immune to user/system date format settings).
     * @param {string} isoStr
     * @returns {Date}
     */
    const parseIsoDate = (isoStr) => {
        const parts = String(isoStr).split('-');
        return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    };

    /**
     * Collects all active Revenue Sheet and Internal Budget record IDs for the contract.
     * @returns {Array<Object>}
     */
    const getInputData = () => {
        const script = runtime.getCurrentScript();
        const contractId = script.getParameter({ name: PARAMS.CONTRACT_ID });
        const endDateIso = script.getParameter({ name: PARAMS.END_DATE });
        const servicesRaw = script.getParameter({ name: PARAMS.SERVICES });
        const serviceIds = !isNullOrEmpty(servicesRaw)
            ? String(servicesRaw).split(',').filter(Boolean)
            : [];

        if (isNullOrEmpty(contractId) || isNullOrEmpty(endDateIso)) {
            const errDetails = `contractId=${contractId}, endDateIso=${endDateIso}. ` +
                `Please ensure script parameters [${PARAMS.CONTRACT_ID}, ${PARAMS.END_DATE}, ${PARAMS.SERVICES}] ` +
                `are created on the script record customscript_uds_mr_contract_extend under the Parameters subtab.`;
            log.error({
                title: 'Missing Required Parameters',
                details: errDetails
            });
            throw new Error(errDetails);
        }

        const workItems = [];

        RECORD_CONFIGS.forEach((cfg) => {
            const filters = [
                [cfg.CONTRACT_FIELD, 'anyof', contractId],
                'AND',
                ['isinactive', 'is', 'F']
            ];

            // Filter where today is between valid from and valid till
            if (cfg.VALID_FROM_FIELD) {
                filters.push('AND', [cfg.VALID_FROM_FIELD, 'onorbefore', 'today']);
            }
            if (cfg.VALID_TILL_FIELD) {
                filters.push('AND', [cfg.VALID_TILL_FIELD, 'onorafter', 'today']);
            }

            if (cfg.SERVICE_FIELD && serviceIds.length > 0) {
                filters.push('AND', [cfg.SERVICE_FIELD, 'anyof', serviceIds]);
            }

            const recSearch = search.create({
                type: cfg.TYPE,
                filters: filters,
                columns: ['internalid', cfg.VALID_TILL_FIELD]
            });

            const pagedData = recSearch.runPaged({ pageSize: 1000 });
            pagedData.pageRanges.forEach((pageRange) => {
                const page = pagedData.fetch({ index: pageRange.index });
                page.data.forEach((res) => {
                    workItems.push({
                        type: cfg.TYPE,
                        id: res.id,
                        validFromField: cfg.VALID_FROM_FIELD,
                        validTillField: cfg.VALID_TILL_FIELD,
                        previousValidTillRaw: res.getValue({ name: cfg.VALID_TILL_FIELD }),
                        endDateIso: endDateIso
                    });
                });
            });
        });

        log.audit({
            title: 'Contract Extend Input Collected',
            details: `Contract ID: ${contractId}, End Date: ${endDateIso}, Services: ${serviceIds.join(',') || 'ALL'}, Total Records: ${workItems.length}`
        });

        return workItems;
    };

    /**
     * Copies a single Revenue Sheet or Internal Budget record and updates Valid From / Valid Till.
     * @param {Object} context
     */
    const map = (context) => {
        const item = JSON.parse(context.value);
        const newEndDate = parseIsoDate(item.endDateIso);

        const copiedRec = record.copy({
            type: item.type,
            id: item.id,
            isDynamic: false
        });

        let previousValidTill = item.previousValidTillRaw;
        if (isNullOrEmpty(previousValidTill)) {
            previousValidTill = copiedRec.getValue({ fieldId: item.validTillField });
        }

        if (!isNullOrEmpty(previousValidTill)) {
            let prevDateVal = previousValidTill;
            if (!(prevDateVal instanceof Date)) {
                try {
                    prevDateVal = format.parse({ value: String(prevDateVal), type: format.Type.DATE });
                } catch (e) {
                    log.error({
                        title: `Date Parse Error for previousValidTill on ${item.type} ID ${item.id}`,
                        details: e
                    });
                }
            }
            if (prevDateVal instanceof Date) {
                copiedRec.setValue({
                    fieldId: item.validFromField,
                    value: prevDateVal
                });
            }
        }

        copiedRec.setValue({
            fieldId: item.validTillField,
            value: newEndDate
        });

        const newId = copiedRec.save({
            enableSourcing: true,
            ignoreMandatoryFields: false
        });

        context.write({
            key: item.type,
            value: String(newId)
        });
    };

    /**
     * Logs summary counts and any per-record errors.
     * @param {Object} summary
     */
    const summarize = (summary) => {
        if (summary.inputSummary.error) {
            log.error({ title: 'Input Error', details: summary.inputSummary.error });
        }

        let errorCount = 0;
        summary.mapSummary.errors.iterator().each((key, error) => {
            errorCount++;
            log.error({ title: `Map Error (Key ${key})`, details: error });
            return true;
        });

        const countsByType = {};
        summary.output.iterator().each((key, value) => {
            countsByType[key] = (countsByType[key] || 0) + 1;
            return true;
        });

        log.audit({
            title: 'Contract Extend Map/Reduce Complete',
            details: `Created: ${JSON.stringify(countsByType)}, Errors: ${errorCount}`
        });
    };

    return {
        getInputData,
        map,
        summarize
    };
});
