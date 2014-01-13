/*
 * Copyright (C) 2013 TopCoder Inc., All Rights Reserved.
 *
 * @version 1.5
 * @author Sky_, mekanizumu, TCSASSEMBLER, freegod, Ghost_141
 * @changes from 1.0
 * merged with Member Registration API
 * changes in 1.1:
 * 1. add stub for Get Studio Contest Detail
 * changes in 1.2:
 * 1. Add an optional parameter to search contest api - cmc
 * 2. Display cmc value search contest and contest detail API response.
 * 3. Remove contest description from search contest API response.
 * changes in 1.3:
 * 1. move studio API to separated file
 * changes in 1.4:
 *  - Use empty result set instead of 404 error in get challenges API.
 * changes in 1.5:
 * 1. Update the logic when get results from database since the query has been updated.
 * changes in 1.6:
 * merge the backend logic of search software contests and studio contests together.
 */
"use strict";

require('datejs');
var async = require('async');
var S = require('string');
var _ = require('underscore');
var IllegalArgumentError = require('../errors/IllegalArgumentError');
var NotFoundError = require('../errors/NotFoundError');

/**
 * Represents the sort column value. This value will be used in log, check, get information from request etc.
 */
var SORT_COLUMN = "sortColumn";

/**
 * Represents the default sort column.
 */
var DEFAULT_SORT_COLUMN = "challengeName";

/**
 * Represents a predefined list of valid query parameter for all contest types.
 */
var ALLOWABLE_QUERY_PARAMETER = [
    "listType", "challengeType", "challengeName", "projectId", SORT_COLUMN,
    "sortOrder", "pageIndex", "pageSize", "prizeLowerBound", "prizeUpperBound", "cmcTaskId"];

/**
 * Represents a predefined list of valid sort column for active contest.
 */
var ALLOWABLE_SORT_COLUMN = [
    "challengeName", "challengeType", "challengeId", "cmcTaskId", "registrationEndDate",
    "submissionEndDate", "finalFixEndDate", "prize1", "currentStatus", "digitalRunPoints"
];

/**
 * Represents a ListType enum
 */
var ListType = { ACTIVE: "ACTIVE", OPEN: "OPEN", UPCOMING: "UPCOMING", PAST: "PAST" };

/**
 * Represents a predefined list of valid list type.
 */
var ALLOWABLE_LIST_TYPE = [ListType.ACTIVE, ListType.OPEN, ListType.UPCOMING, ListType.PAST];

/**
 * Represents Percentage of Placement Points for digital run
 */
var DR_POINT = [[1], [0.7, 0.3], [0.65, 0.25, 0.10], [0.6, 0.22, 0.1, 0.08], [0.56, 0.2, 0.1, 0.08, 0.06]];

/**
 * Max value for integer
 */
var MAX_INT = 2147483647;

/**
 * The list type and submission phase status map.
 */
var LIST_TYPE_SUBMISSION_STATUS_MAP = {};
LIST_TYPE_SUBMISSION_STATUS_MAP[ListType.ACTIVE] = [1, 2, 3];
LIST_TYPE_SUBMISSION_STATUS_MAP[ListType.OPEN] = [1, 2];
LIST_TYPE_SUBMISSION_STATUS_MAP[ListType.UPCOMING] = [1];
LIST_TYPE_SUBMISSION_STATUS_MAP[ListType.PAST] = [3];

/**
 * The list type and project status map.
 */
var LIST_TYPE_PROJECT_STATUS_MAP = {};
LIST_TYPE_PROJECT_STATUS_MAP[ListType.ACTIVE] = [1];
LIST_TYPE_PROJECT_STATUS_MAP[ListType.OPEN] = [1];
LIST_TYPE_PROJECT_STATUS_MAP[ListType.UPCOMING] = [2];
LIST_TYPE_PROJECT_STATUS_MAP[ListType.PAST] = [4, 5, 6, 7, 8, 9, 10, 11];

/**
 * This method will used to check the query parameter and sort column of the request.
 *
 * @param {Object} helper - the helper.
 * @param {String} type - the contest type.
 * @param {Object} queryString - the query string object
 * @param {String} sortColumn - the sort column from the request.
 */
function checkQueryParameterAndSortColumn(helper, type, queryString, sortColumn) {
    var allowedQuery = helper.getLowerCaseList(ALLOWABLE_QUERY_PARAMETER),
        allowedSort = helper.getLowerCaseList(ALLOWABLE_SORT_COLUMN),
        currentQuery = helper.getLowerCaseList(Object.keys(queryString)),
        error;
    currentQuery.forEach(function (n) {
        if (allowedQuery.indexOf(n) === -1) {
            error = error ||
                new IllegalArgumentError("The query parameter contains invalid parameter for contest type '" +
                    type + "'.");
        }
    });
    if (allowedSort.indexOf(sortColumn.toLowerCase()) === -1) {
        error = error || new IllegalArgumentError("The sort column '" + sortColumn +
            "' is invalid for contest type '" + type + "'.");
    }
    return error;
}


/**
 * This method is used to validate input parameter of the request.
 * @param {Object} helper - the helper.
 * @param {Object} query - the query string.
 * @param {Object} filter - the filter.
 * @param {Integer} pageIndex - the page index.
 * @param {Integer} pageSize - the page size.
 * @param {String} sortColumn - the sort column.
 * @param {String} sortOrder - the sort order.
 * @param {String} type - the type of contest.
 * @param {Object} dbConnectionMap - the database connection map.
 * @param {Function<err>} callback - the callback function.
 */
function validateInputParameter(helper, query, filter, pageIndex, pageSize, sortColumn, sortOrder, type, dbConnectionMap, callback) {
    var error = helper.checkContains(['asc', 'desc'], sortOrder.toLowerCase(), "sortOrder") ||
            helper.checkPageIndex(pageIndex, "pageIndex") ||
            helper.checkPositiveInteger(pageSize, "pageSize") ||
            helper.checkMaxNumber(pageSize, MAX_INT, 'pageSize') ||
            helper.checkMaxNumber(pageIndex, MAX_INT, 'pageIndex') ||
            helper.checkContains(ALLOWABLE_LIST_TYPE, type.toUpperCase(), "type") ||
            checkQueryParameterAndSortColumn(helper, type, query, sortColumn);

    if (_.isDefined(filter.projectId)) {
        error = error || helper.checkPositiveInteger(Number(filter.projectId), "projectId");
    }
    if (_.isDefined(filter.prizeLowerBound)) {
        error = error || helper.checkNonNegativeNumber(Number(filter.prizeLowerBound), "prizeLowerBound");
    }
    if (_.isDefined(filter.prizeUpperBound)) {
        error = error || helper.checkNonNegativeNumber(Number(filter.prizeUpperBound), "prizeUpperBound");
    }
    if (error) {
        callback(error);
        return;
    }
    if (_.isDefined(query.challengeType)) {
        helper.isCategoryNameValid(query.challengeType, dbConnectionMap, callback);
    } else {
        callback();
    }
}

/**
 * This method will set up filter for sql query.
 *
 * @param {Object} filter - the filter from http request.
 * @param {Object} sqlParams - the parameters for sql query.
 */
function setFilter(filter, sqlParams) {
    sqlParams.challengeName = "%";
    sqlParams.prilower = 0;
    sqlParams.priupper = MAX_INT;
    sqlParams.tcdirectid = 0;

    if (_.isDefined(filter.challengeType)) {
        sqlParams.categoryName = filter.challengeType.toLowerCase();
    }
    if (_.isDefined(filter.challengeName)) {
        sqlParams.challengeName = "%" + filter.challengeName.toLowerCase() + "%";
    }
    if (_.isDefined(filter.prizeLowerBound)) {
        sqlParams.prilower = filter.prizeLowerBound.toLowerCase();
    }
    if (_.isDefined(filter.prizeUpperBound)) {
        sqlParams.priupper = filter.prizeUpperBound.toLowerCase();
    }
    if (_.isDefined(filter.projectId)) {
        sqlParams.tcdirectid = filter.projectId;
    }
    if (_.isDefined(filter.cmcTaskId)) {
        sqlParams.cmc = filter.cmcTaskId;
    }
}

/**
 * Convert null string or if string is equal to "null"
 * @param {String} str - the string to convert.
 * @return {String} converted string
 */
function convertNull(str) {
    if (!str || str === "null") {
        return "";
    }
    return str;
}


/**
 * Format date
 * @param {Date} date date to format
 * @return {String} formatted date
 */
function formatDate(date) {
    if (!date) {
        return "";
    }
    return date;
}

/**
 * This method will get data from the query result.
 *
 * @param {Array} src - the query result.
 * @param {Object} helper - the helper object.
 * @return {Array} a list of transferred contests
 */
function transferResult(src, helper) {
    var ret = [];
    src.forEach(function (row) {
        var contest = {
            challengeType : row.challenge_type,
            challengeName : row.challenge_name,
            challengeId : row.challenge_id,
            projectId : row.project_id,
            forumId : row.forum_id,
            numSubmissions : row.num_submissions,
            numRegistrants : row.num_registrants,
            screeningScorecardId : row.screening_scorecard_id,
            reviewScorecardId : row.review_scorecard_id,
            cmcTaskId : convertNull(row.cmc_task_id),
            numberOfCheckpointsPrizes : row.number_of_checkpoints_prizes,
            topCheckPointPrize : convertNull(row.top_checkpoint_prize),
            postingDate : formatDate(row.posting_date),
            registrationEndDate : formatDate(row.registration_end_date),
            checkpointSubmissionEndDate : formatDate(row.checkpoint_submission_end_date),
            submissionEndDate : formatDate(row.submission_end_date),
            appealsEndDate : formatDate(row.appeals_end_date),
            finalFixEndDate : formatDate(row.final_fix_end_date),
            currentPhaseEndDate : formatDate(row.current_phase_end_date),
            currentPhaseRemainingTime : row.current_phase_remaining_time,
            currentStatus : row.current_status,
            currentPhaseName : convertNull(row.current_phase_name),
            digitalRunPoints: row.digital_run_points,
            prize: [],
            reliabilityBonus: helper.getReliabilityBonus(row.prize1),
            challengeCommunity: row.is_studio ? 'design' : 'develop'
        },
            i,
            prize;
        for (i = 1; i < 10; i = i + 1) {
            prize = row["prize" + i];
            if (prize && prize !== -1) {
                contest.prize.push(prize);
            }
        }
        ret.push(contest);
    });
    return ret;
}


/**
 * This is the function that actually search contests
 *
 * @param {Object} api - The api object that is used to access the global infrastructure
 * @param {Object} connection - The connection object for the current request
 * @param {Object} dbConnectionMap The database connection map for the current request
 * @param {String} community - The community string that represent which contest to search.
 * @param {Function<connection, render>} next - The callback to be called after this function is done
 */
var searchContests = function (api, connection, dbConnectionMap, community, next) {
    var helper = api.helper,
        query = connection.rawConnection.parsedURL.query,
        copyToFilter = ["challengeType", "challengeName", "projectId", "prizeLowerBound",
            "prizeUpperBound", "cmcTaskId"],
        sqlParams = {},
        filter = {},
        pageIndex,
        pageSize,
        sortColumn,
        sortOrder,
        listType,
        prop,
        result = {},
        total,
        contestType;
    for (prop in query) {
        if (query.hasOwnProperty(prop)) {
            query[prop.toLowerCase()] = query[prop];
        }
    }

    switch (community) {
    case helper.studio.community:
        contestType = helper.studio;
        break;
    case helper.software.community:
        contestType = helper.software;
        break;
    case helper.both.community:
        contestType = helper.both;
        break;
    }

    sortOrder = query.sortorder || "asc";
    sortColumn = query.sortcolumn || DEFAULT_SORT_COLUMN;
    listType = (query.listtype || ListType.OPEN).toUpperCase();
    pageIndex = Number(query.pageindex || 1);
    pageSize = Number(query.pagesize || 50);

    copyToFilter.forEach(function (p) {
        if (query.hasOwnProperty(p.toLowerCase())) {
            filter[p] = query[p.toLowerCase()];
        }
    });

    async.waterfall([
        function (cb) {
            validateInputParameter(helper, query, filter, pageIndex, pageSize, sortColumn, sortOrder, listType, dbConnectionMap, cb);
        }, function (cb) {
            if (pageIndex === -1) {
                pageIndex = 1;
                pageSize = MAX_INT;
            }

            setFilter(filter, sqlParams);
            sqlParams.firstRowIndex = (pageIndex - 1) * pageSize;
            sqlParams.pageSize = pageSize;
            sqlParams.sortColumn = sortColumn.toLowerCase();
            sqlParams.sortColumn = helper.getSortColumnDBName(sortColumn.toLowerCase());
            sqlParams.sortOrder = sortOrder.toLowerCase();
            // Set the project type id
            sqlParams.project_type_id = contestType.category;
            // Set the submission phase status id.
            sqlParams.submission_phase_status = LIST_TYPE_SUBMISSION_STATUS_MAP[listType];
            sqlParams.project_status_id = LIST_TYPE_PROJECT_STATUS_MAP[listType];
            api.dataAccess.executeQuery('search_software_studio_contests_count', sqlParams, dbConnectionMap, cb);
        }, function (rows, cb) {
            total = rows[0].total;
            api.dataAccess.executeQuery('search_software_studio_contests', sqlParams, dbConnectionMap, cb);
        }, function (rows, cb) {
            if (rows.length === 0) {
                result.data = [];
                result.total = total;
                result.pageIndex = pageIndex;
                result.pageSize = pageIndex === -1 ? total : pageSize;
                cb();
                return;
            }
            result.data = transferResult(rows, helper);
            result.total = total;
            result.pageIndex = pageIndex;
            result.pageSize = pageIndex === -1 ? total : pageSize;
            cb();
        }
    ], function (err) {
        if (err) {
            helper.handleError(api, connection, err);
        } else {
            connection.response = result;
        }
        next(connection, true);
    });
};

/**
 * This is the function that gets contest details
 * 
 * @param {Object} api - The api object that is used to access the global infrastructure
 * @param {Object} connection - The connection object for the current request
 * @param {Object} dbConnectionMap The database connection map for the current request
 * @param {Boolean} isStudio - the flag that represent if to search studio contests.
 * @param {Function<connection, render>} next - The callback to be called after this function is done
 */
var getContest = function (api, connection, dbConnectionMap, isStudio, next) {
    var contest, error, helper = api.helper, sqlParams, contestType = isStudio ? helper.studio : helper.software;
    async.waterfall([
        function (cb) {
            error = helper.checkPositiveInteger(Number(connection.params.contestId), 'contestId') ||
                helper.checkMaxNumber(Number(connection.params.contestId), MAX_INT, 'contestId');
            if (error) {
                cb(error);
                return;
            }
            sqlParams = {
                contestId: connection.params.contestId,
                project_type_id: contestType.category
            };

            var execQuery = function (name) {
                return function (cbx) {
                    api.dataAccess.executeQuery(name, sqlParams, dbConnectionMap, cbx);
                };
            };
            if (isStudio) {
                async.parallel({
                    details: execQuery('contest_details'),
                    checkpoints: execQuery("get_studio_contest_detail_checkpoints"),
                    submissions: execQuery("get_studio_contest_detail_submissions"),
                    winners: execQuery("get_studio_contest_detail_winners")
                }, cb);
            } else {
                async.parallel({
                    details: execQuery('contest_details'),
                    registrants: execQuery('contest_registrants'),
                    submissions: execQuery('contest_submissions')
                }, cb);
            }
        }, function (results, cb) {
            if (results.details.length === 0) {
                cb(new NotFoundError('Contest not found.'));
                return;
            }
            var data = results.details[0], i = 0, prize = 0,
                mapSubmissions = function (results) {
                    var submissions = [], passedReview = 0, drTable, submission = {};
                    if (isStudio) {
                        submissions = _.map(results.submissions, function (item) {
                            return {
                                submissionId: item.submission_id,
                                submitter: item.handle,
                                submissionTime: formatDate(item.create_date)
                            };
                        });
                    } else {
                        results.submissions.forEach(function (item) {
                            if (item.placement) {
                                passedReview = passedReview + 1;
                            }
                        });
                        drTable = DR_POINT[Math.min(passedReview - 1, 4)];
                        submissions = _.map(results.submissions, function (item) {
                            submission = {
                                handle: item.handle,
                                placement: item.placement || "",
                                screeningScore: item.screening_score,
                                initialScore: item.initial_score,
                                finalScore: item.final_score,
                                points: 0,
                                submissionStatus: item.submission_status,
                                submissionDate: formatDate(item.submission_date)
                            };
                            if (submission.placement && drTable.length >= submission.placement) {
                                submission.points = drTable[submission.placement - 1] * results.details[0].digital_run_points;
                            }
                            return submission;
                        });
                    }
                    return submissions;
                },
                mapRegistrants = function (results) {
                    if (!_.isDefined(results)) {
                        return [];
                    }
                    return _.map(results, function (item) {
                        return {
                            handle: item.handle,
                            reliability: !_.isDefined(item.reliability) ? "n/a" : item.reliability + "%",
                            registrationDate: formatDate(item.inquiry_date)
                        };
                    });
                },
                mapPrize = function (results) {
                    var prizes = [];
                    for (i = 1; i < 10; i = i + 1) {
                        prize = results["prize" + i];
                        if (prize && prize !== -1) {
                            prizes.push(prize);
                        }
                    }
                    return prizes;
                },
                mapWinners = function (results) {
                    if (!_.isDefined(results)) {
                        return [];
                    }
                    return _.map(results, function (s) {
                        return {
                            submissionId: s.submission_id,
                            submitter: s.submitter,
                            submissionTime: s.submission_time,
                            points: s.points,
                            rank: s.rank
                        };
                    });
                },
                mapCheckPoints = function (results) {
                    if (!_.isDefined(results)) {
                        return [];
                    }
                    return _.map(results, function (s) {
                        return {
                            submissionId: s.submission_id,
                            submitter: s.handle,
                            submissionTime: s.create_date
                        };
                    });
                };
            contest = {
                challengeType : data.challenge_type,
                challengeName : data.challenge_name,
                challengeId : data.challenge_id,
                projectId : data.project_id,
                forumId : data.forum_id,
                introduction: data.introduction,
                detailedRequirements : isStudio ? data.studio_detailed_requirements : data.software_detailed_requirements,
                finalSubmissionGuidelines : data.final_submission_guidelines,
                screeningScorecardId : data.screening_scorecard_id,
                reviewScorecardId : data.review_scorecard_id,
                cmcTaskId : convertNull(data.cmc_task_id),
                numberOfCheckpointsPrizes : data.number_of_checkpoints_prizes,
                topCheckPointPrize : convertNull(data.top_checkpoint_prize),
                postingDate : formatDate(data.posting_date),
                registrationEndDate : formatDate(data.registration_end_date),
                checkpointSubmissionEndDate : formatDate(data.checkpoint_submission_end_date),
                submissionEndDate : formatDate(data.submission_end_date),
                appealsEndDate : formatDate(data.appeals_end_date),
                finalFixEndDate : formatDate(data.final_fix_end_date),
                currentPhaseEndDate : formatDate(data.current_phase_end_date),
                currentStatus : data.current_status,
                currentPhaseName : convertNull(data.current_phase_name),
                currentPhaseRemainingTime : data.current_phase_remaining_time,
                digitalRunPoints: data.digital_run_points,
                reliabilityBonus: helper.getReliabilityBonus(data.prize1),
                challengeCommunity: contestType.community,
                directUrl : helper.getDirectProjectLink(data.challenge_id),

                technology: data.technology.split(', '),
                prize: mapPrize(data),
                registrants: mapRegistrants(results.registrants),
                checkpoints: mapCheckPoints(results.checkpoints),
                submissions: mapSubmissions(results),
                winners: mapWinners(results.winners)
            };

            if (isStudio) {
                delete contest.registrants;
                delete contest.finalSubmissionGuidelines;
                delete contest.reliabilityBonus;
                delete contest.technology;
            } else {
                contest.numberOfSubmissions = results.submissions.length;
                contest.numberOfRegistrants = results.registrants.length;
                delete contest.checkpoints;
                delete contest.winners;
                delete contest.introduction;
            }
            cb();
        }
    ], function (err) {
        if (err) {
            helper.handleError(api, connection, err);
        } else {
            connection.response = contest;
        }
        next(connection, true);
    });
};

/**
 * The API for getting contest
 */
exports.getSoftwareContest = {
    name: "getSoftwareContest",
    description: "getSoftwareContest",
    inputs: {
        required: ["contestId"],
        optional: []
    },
    blockedConnectionTypes: [],
    outputExample: {},
    version: 'v2',
    transaction : 'read', // this action is read-only
    databases : ["tcs_catalog"],
    run: function (api, connection, next) {
        if (this.dbConnectionMap) {
            api.log("Execute getContest#run", 'debug');
            getContest(api, connection, this.dbConnectionMap, false, next);
        } else {
            api.helper.handleNoConnection(api, connection, next);
        }
    }
};

/**
 * The API for getting studio contest
 */
exports.getStudioContest = {
    name: "getStudioContest",
    description: "getStudioContest",
    inputs: {
        required: ["contestId"],
        optional: []
    },
    blockedConnectionTypes: [],
    outputExample: {},
    version: 'v2',
    transaction: 'read', // this action is read-only
    databases: ["tcs_catalog", "tcs_dw"],
    run: function (api, connection, next) {
        if (this.dbConnectionMap) {
            api.log("Execute getStudioContest#run", 'debug');
            getContest(api, connection, this.dbConnectionMap, true, next);
        } else {
            api.helper.handleNoConnection(api, connection, next);
        }
    }
};

/**
 * The API for searching contests
 */
exports.searchSoftwareContests = {
    name: "searchSoftwareContests",
    description: "searchSoftwareContests",
    inputs: {
        required: [],
        optional: ALLOWABLE_QUERY_PARAMETER
    },
    blockedConnectionTypes: [],
    outputExample: {},
    version: 'v2',
    transaction : 'read', // this action is read-only
    databases : ["tcs_catalog"],
    run: function (api, connection, next) {
        if (this.dbConnectionMap) {
            api.log("Execute searchSoftwareContests#run", 'debug');
            searchContests(api, connection, this.dbConnectionMap, 'develop', next);
        } else {
            api.helper.handleNoConnection(api, connection, next);
        }
    }
};

/**
 * The API for searching contests
 */
exports.searchStudioContests = {
    name: "searchStudioContests",
    description: "searchStudioContests",
    inputs: {
        required: [],
        optional: ALLOWABLE_QUERY_PARAMETER
    },
    blockedConnectionTypes: [],
    outputExample: {},
    version: 'v2',
    transaction : 'read', // this action is read-only
    databases : ["tcs_catalog"],
    run: function (api, connection, next) {
        if (this.dbConnectionMap) {
            api.log("Execute searchStudioContests#run", 'debug');
            searchContests(api, connection, this.dbConnectionMap, 'design', next);
        } else {
            api.helper.handleNoConnection(api, connection, next);
        }
    }
};

/**
 * Generic API for searching contests
 */
exports.searchSoftwareAndStudioContests = {
    name: "searchSoftwareAndStudioContests",
    description: "searchSoftwareAndStudioContests",
    inputs: {
        required: [],
        optional: ALLOWABLE_QUERY_PARAMETER
    },
    blockedConnectionTypes: [],
    outputExample: {},
    version: 'v2',
    transaction : 'read', // this action is read-only
    databases : ["tcs_catalog"],
    run: function (api, connection, next) {
        if (this.dbConnectionMap) {
            api.log("Execute searchSoftwareAndStudioContests#run", 'debug');
            searchContests(api, connection, this.dbConnectionMap, 'both', next);
        } else {
            api.helper.handleNoConnection(api, connection, next);
        }
    }
};
