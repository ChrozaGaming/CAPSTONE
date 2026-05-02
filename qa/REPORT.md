# SQA Test Report — Automated Dimensional Inspection v2.2.0

> ✅ **ALL TESTS PASSED — APPROVED FOR RELEASE**

## 📄 Document Metadata

| Field | Value |
|---|---|
| Document ID | `SQA-DIM-INSP-001` |
| Revision | rev. 1.0 |
| Generated | 2026-05-02T18:15:36.036Z |
| Generated (local) | 3/5/2026, 01.15.36 WIB |
| Run started | 2026-05-02T18:15:32.821Z |
| Wall-clock duration | 3215ms |

## 👤 Tester / Author

| Field | Value |
|---|---|
| Name | **Hilmy Raihan Alkindy** |
| Email | hilmyraihankindy@gmail.com |
| Affiliation | Capstone A3 Kelompok 2 — Filkom Universitas Brawijaya |

## 🎯 Project Under Test

| Field | Value |
|---|---|
| Project | Automated Dimensional Inspection |
| Version | `v2.2.0` |
| Module | Backend Hybrid Integration (REST + PostgreSQL + WebSocket) |
| Repository | <https://github.com/ChrozaGaming/CAPSTONE> |
| Git branch | `main` |
| Git commit | `f24e488` |
| Working tree dirty | YES (uncommitted changes) |

## 📋 Test Plan

| Field | Value |
|---|---|
| Test level | Integration / End-to-End |
| Test strategy | Black-box (REST API contract) + White-box (direct PG DML) |
| Pass criteria | 100% TC PASS, no critical/major defect |
| Total test cases | 29 |

## 🖥 Test Environment

### System

| Field | Value |
|---|---|
| Hostname | `macbooks-MacBook-Pro.local` |
| User | `macbookpro` |
| OS | Darwin 25.3.0 (darwin/arm64) |
| CPU | Apple M4 Max × 16 cores |
| Memory | 48.00 GB |

### Runtime

| Field | Value |
|---|---|
| Node.js | v24.11.1 |
| npm | 11.6.2 |
| PostgreSQL | 18.1 |

### Targets

| Field | Value |
|---|---|
| REST endpoint | http://localhost:3000 |
| WebSocket endpoint | ws://localhost:3000/ws |
| PG host | `localhost:5432` |
| PG database | `capstone` |
| PG user | `postgres` |
| Server port | `3000` |

---

## 🏁 Verdict

✅ **ALL TESTS PASSED — APPROVED FOR RELEASE**

## 📊 Executive Summary

| Metric | Value |
|---|---|
| Total test cases | 29 |
| Passed | **29** ✅ |
| Failed | 0  |
| Pass rate | **100.0%** |
| Cumulative TC duration | 3213ms |
| Avg duration / TC | 110.8ms |
| Critical defects | 0 |
| Test marker prefix | `SQA-1777745732821` |

## 🗂 Category Breakdown

| Category | Passed | Failed | Pass Rate | Duration | Status |
|---|---|---|---|---|---|
| `connectivity` | 3 | 0 | 100% | 26ms | ✅ |
| `schema` | 6 | 0 | 100% | 26ms | ✅ |
| `rest-write` | 5 | 0 | 100% | 222ms | ✅ |
| `websocket` | 2 | 0 | 100% | 207ms | ✅ |
| `pg-dml` | 5 | 0 | 100% | 1212ms | ✅ |
| `analytics` | 3 | 0 | 100% | 13ms | ✅ |
| `pending` | 3 | 0 | 100% | 3ms | ✅ |
| `cleanup` | 2 | 0 | 100% | 1504ms | ✅ |

## 🔍 Detailed Test Results

| ID | Category | Description | Status | Duration |
|---|---|---|---|---|
| `TC-A01` | connectivity | REST server reachable on /api/v1/status | ✅ PASS | 21ms |
| `TC-A02` | connectivity | PostgreSQL connected (status.pg.connected=true) | ✅ PASS | 2ms |
| `TC-A03` | connectivity | WebSocket handshake on /ws | ✅ PASS | 3ms |
| `TC-B01` | schema | Table public.inspections exists | ✅ PASS | 13ms |
| `TC-B02` | schema | View v_inspection_summary exists | ✅ PASS | 1ms |
| `TC-B03` | schema | View v_inspection_daily_trend exists | ✅ PASS | 1ms |
| `TC-B04` | schema | Index idx_inspections_ts_desc exists | ✅ PASS | 1ms |
| `TC-B05` | schema | CHECK constraint status IN (OK,NG) | ✅ PASS | 9ms |
| `TC-B06` | schema | CHECK constraint dimension_mm > 0 | ✅ PASS | 1ms |
| `TC-C01` | rest-write | POST /inspection accepts valid payload (status 201) | ✅ PASS | 9ms |
| `TC-C02` | rest-write | POSTed row appears in JSON file (data/inspections.json) | ✅ PASS | 0ms |
| `TC-C03` | rest-write | POSTed row mirrored to PostgreSQL (id-consistent) | ✅ PASS | 211ms |
| `TC-C04` | rest-write | POST /inspection rejects missing dimension_mm (status 400) | ✅ PASS | 1ms |
| `TC-C05` | rest-write | POST /inspection rejects invalid status (status 400) | ✅ PASS | 1ms |
| `TC-D01` | websocket | WS receives inspection.created on POST | ✅ PASS | 104ms |
| `TC-D02` | websocket | WS receives pending.created on POST /api/pending | ✅ PASS | 103ms |
| `TC-E01` | pg-dml | Direct INSERT INTO inspections succeeds | ✅ PASS | 4ms |
| `TC-E02` | pg-dml | Direct DML row visible via /api/v1/inspection (PG-backed) | ✅ PASS | 2ms |
| `TC-E03` | pg-dml | Direct DML row visible via /inspection too (PG → JSON sync) | ✅ PASS | 1203ms |
| `TC-E04` | pg-dml | UPDATE via DML reflected in PG queries | ✅ PASS | 2ms |
| `TC-E05` | pg-dml | PG view v_inspection_summary aggregates DML row | ✅ PASS | 1ms |
| `TC-F01` | analytics | GET /api/v1/stats/by-object returns aggregations | ✅ PASS | 9ms |
| `TC-F02` | analytics | GET /api/v1/stats/trend returns daily breakdown | ✅ PASS | 2ms |
| `TC-F03` | analytics | GET /api/v1/stats/recent returns last 100 rows | ✅ PASS | 2ms |
| `TC-G01` | pending | POST /api/pending creates entry | ✅ PASS | 1ms |
| `TC-G02` | pending | POST /api/pending/:id/name sets name | ✅ PASS | 1ms |
| `TC-G03` | pending | POST same name twice rejects (409 Conflict) | ✅ PASS | 1ms |
| `TC-H01` | cleanup | Direct PG DELETE removes test rows | ✅ PASS | 1ms |
| `TC-H02` | cleanup | JSON sync state matches PG after PG DELETE | ✅ PASS | 1503ms |

---

## ✍️ Sign-off

| Field | Value |
|---|---|
| Tested by | Hilmy Raihan Alkindy |
| Test execution date | 3/5/2026, 01.15.36 WIB |
| Recommendation | **Approve for release.** All acceptance criteria met. |
| Next action | Tag release & deploy. |

---

*Hak Cipta © Capstone Topik A3 Kelompok 2, Fakultas Ilmu Komputer, Universitas Brawijaya.*
*Report generated by `qa/test_suite.js` — automated SQA harness.*
