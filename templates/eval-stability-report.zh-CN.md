# 评测稳定性复测（6 样本）- {{date}} - r{{roundIndex}}

## 结论摘要
成功率：{{success_rate}}
失败分布：{{failure_distribution}}
终止原因：{{abort_reason}}
旧错误簇：{{old_error_cluster_summary}}

## 样本结果
| caseId | status | errorCode | auditPath | eventsPath |
| --- | --- | --- | --- | --- |
{{case_table}}

## 旧错误簇
{{old_error_cluster_detail}}

## 备注
eventsMissingCases：{{events_missing_cases}}
auditMissingCases：{{audit_missing_cases}}
stdoutParseErrorCases：{{stdout_parse_error_cases}}
targetRepoRevision：{{target_repo_revision}}
abortAtCaseId：{{abort_at_case_id}}
abortDuringResourceCheck：{{abort_during_resource_check}}
roundAbortedReason：{{abort_reason}}
notes：{{notes}}
