# CDC Sync Test Report — Automated Dimensional Inspection v2.2.0

> ✅ **ALL TESTS PASSED — BIDIRECTIONAL CDC SYNC VERIFIED**

## 📄 Document Metadata

| Field | Value |
|---|---|
| Document ID | `SQA-CDC-002` |
| Revision | rev. 1.0 |
| Generated | 2026-05-02T18:16:07.267Z |
| Generated (local) | 3/5/2026, 01.16.07 WIB |

## 👤 Tester

| Field | Value |
|---|---|
| Name | **Hilmy Raihan Alkindy** |
| Email | hilmyraihankindy@gmail.com |
| Affiliation | Capstone A3 Kelompok 2 — Filkom Universitas Brawijaya |

## 🎯 Project & Module

| Field | Value |
|---|---|
| Project | Automated Dimensional Inspection |
| Version | `v2.2.0` |
| Module | Bidirectional CDC Sync (PG ↔ JSON ↔ WebSocket) |
| Git branch / commit | `main` / `f24e488` |
| Working tree dirty | YES (uncommitted changes) |

## 📋 Test Plan

| Field | Value |
|---|---|
| Test level | Integration / End-to-End / Data Consistency |
| Test strategy | Black-box (REST/WS contract) + Gray-box (DB triggers + file watcher) |
| Pass criteria | 100% TC PASS — bidirectional sync teruji untuk semua sumber perubahan |

## 🎯 Requirement Coverage

Setiap kategori memetakan ke requirement user:

| Requirement (user request) | Section | Status |
|---|---|---|
| Dashboard baca dari PG, BUKAN session storage browser | B | ✅ Verified |
| Real-time WS push pada perubahan PG | E | ✅ Verified |
| JSON sebagai mirror untuk riwayat/backup | F | ✅ Verified |
| psql DELETE/INSERT → JSON ikut sync | C | ✅ Verified |
| JSON edit → PG ikut sync (FK-like) | D | ✅ Verified |
| Safety: tidak ada feedback loop | G | ✅ Verified |

## 🖥 Environment

| Field | Value |
|---|---|
| Hostname | `macbooks-MacBook-Pro.local` |
| OS | Darwin 25.3.0 (darwin/arm64) |
| CPU | Apple M4 Max × 16 |
| Node.js | v24.11.1 |
| PostgreSQL | 18.1 |
| Targets | REST `http://localhost:3000` · WS `ws://localhost:3000/ws` |

---

## 🏁 Verdict

✅ **ALL TESTS PASSED — BIDIRECTIONAL CDC SYNC VERIFIED**

## 📊 Executive Summary

| Metric | Value |
|---|---|
| Total test cases | 23 |
| Passed | **23** ✅ |
| Failed | 0  |
| Pass rate | **100.0%** |
| Total duration | 30201ms |
| Test marker | `CDC-1777745736188` |

## 🗂 Category Breakdown

| Category | Passed | Failed | Pass Rate | Duration | Status |
|---|---|---|---|---|---|
| `connectivity` | 4 | 0 | 100% | 29ms | ✅ |
| `dashboard-pg` | 3 | 0 | 100% | 1620ms | ✅ |
| `pg-to-json` | 4 | 0 | 100% | 5632ms | ✅ |
| `json-to-pg` | 3 | 0 | 100% | 9936ms | ✅ |
| `realtime-ws` | 3 | 0 | 100% | 4986ms | ✅ |
| `rest-consistency` | 3 | 0 | 100% | 3160ms | ✅ |
| `safety` | 2 | 0 | 100% | 3830ms | ✅ |
| `cleanup` | 1 | 0 | 100% | 1008ms | ✅ |

## 🔍 Detailed Results

| ID | Category | Description | Status | Duration |
|---|---|---|---|---|
| `TC-A01` | connectivity | REST server reachable | ✅ PASS | 15ms |
| `TC-A02` | connectivity | PostgreSQL connected (pgReady=true) | ✅ PASS | 1ms |
| `TC-A03` | connectivity | WebSocket /ws handshake | ✅ PASS | 3ms |
| `TC-A04` | connectivity | PG triggers installed (inspection_change_trigger) | ✅ PASS | 10ms |
| `TC-B01` | dashboard-pg | GET /inspection returns source=postgres when PG up | ✅ PASS | 3ms |
| `TC-B02` | dashboard-pg | Direct psql INSERT visible via GET /inspection within 1s | ✅ PASS | 811ms |
| `TC-B03` | dashboard-pg | Browser-cached state irrelevant — server returns fresh PG state | ✅ PASS | 806ms |
| `TC-C01` | pg-to-json | psql INSERT row → JSON file gets row within 1.5s | ✅ PASS | 1204ms |
| `TC-C02` | pg-to-json | psql UPDATE row → JSON row updated within 1.5s | ✅ PASS | 1203ms |
| `TC-C03` | pg-to-json | psql DELETE row → JSON row removed within 1.5s | ✅ PASS | 1204ms |
| `TC-C04` | pg-to-json | psql TRUNCATE → JSON cleared within 1.5s | ✅ PASS | 2021ms |
| `TC-D01` | json-to-pg | Edit JSON manual (add row) → PG INSERT within 2.5s | ✅ PASS | 2208ms |
| `TC-D02` | json-to-pg | Edit JSON manual (remove row) → PG DELETE within 2.5s | ✅ PASS | 2204ms |
| `TC-D03` | json-to-pg | Safety: JSON corrupt (sintaks salah) → PG TIDAK dihapus | ✅ PASS | 5524ms |
| `TC-E01` | realtime-ws | psql INSERT → WS event "inspection.created" | ✅ PASS | 1661ms |
| `TC-E02` | realtime-ws | psql DELETE → WS event "inspection.deleted" | ✅ PASS | 1661ms |
| `TC-E03` | realtime-ws | REST POST /inspection → WS event "inspection.created" | ✅ PASS | 1664ms |
| `TC-F01` | rest-consistency | REST POST → row di PG dan JSON identik | ✅ PASS | 815ms |
| `TC-F02` | rest-consistency | REST DELETE /inspection/:id → both stores updated | ✅ PASS | 1321ms |
| `TC-F03` | rest-consistency | REST DELETE /inspection (clear all) → both cleared | ✅ PASS | 1024ms |
| `TC-G01` | safety | Server own write tidak men-trigger watcher (no infinite loop) | ✅ PASS | 2171ms |
| `TC-G02` | safety | Trigger function dan listener client masih hidup | ✅ PASS | 1659ms |
| `TC-H01` | cleanup | Hapus semua row test (PG + JSON sync via TRUNCATE) | ✅ PASS | 1008ms |

---

## ✍️ Sign-off

| Field | Value |
|---|---|
| Tested by | Hilmy Raihan Alkindy |
| Date | 3/5/2026, 01.16.07 WIB |
| Recommendation | **Approve.** Bidirectional sync teruji untuk semua sumber perubahan. |

---

*Hak Cipta © Capstone Topik A3 Kelompok 2, Filkom Universitas Brawijaya.*
