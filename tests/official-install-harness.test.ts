import assert from 'node:assert/strict'
import { test } from 'node:test'
import { verifyInstallReport } from '../scripts/verify-official-install.mjs'

function completeReport(): any {
  const report: any = {
    install: { code: 0 }, stockUnmodified: true, checks: [], createdWorkspace: { status: 200 },
    workspacePreserved: true, disabledStoreUnchanged: true, userStorePreserved: true, uninstall: { code: 0 },
    stockSticker: { authenticatedStatus: 200, type: 'image/webp', matchesOriginal: true, unauthenticatedStatus: 401 },
    liveToggle: { disableStatus: 200, disabledApiStatus: 404, disabledClientStatus: 404, enableStatus: 200,
      enabledApiStatus: 200, enabledClientStatus: 200, storeUnchangedWhileDisabled: true },
  }
  for (const phase of ['enabled', 'disabled', 'reenabled', 'uninstalled']) {
    const active = phase === 'enabled' || phase === 'reenabled'
    report[phase + 'Shutdown'] = { code: 0, graceful: true }
    report.checks.push({
      phase, startup: { status: 'ready' }, frontendStatus: 200, frontendHasPlugin: active,
      stateStatus: active ? 200 : 404, clientStatus: active ? 200 : 404,
      diagnostics: { logs: [], plugins: active ? [{ enabled: true, fiberPhase: 'active' }] : [] },
      seatCount: 13, derivedCount: 108, setupNeeded: false, backgroundMode: 'preset',
      visualDefaults: { magazineMode: 'full', codeBackground: { enabled: true, intensity: 0.7, interactive: true }, mascot: 'reactive', ambient: true },
      sameValuePut: { status: 200, unchanged: true },
      assets: Array.from({ length: 108 }, () => ({ status: 200, type: 'image/webp' })),
      covers: Array.from({ length: 13 }, () => ({ status: 200, webp: true, bytes: 100 })),
    })
  }
  return report
}

const full = { lifecycle: true, sticker: true, expectedSeats: 13, expectedAssets: 108 }

test('official installation gate accepts a complete lifecycle and rejects incomplete evidence', () => {
  assert.equal(verifyInstallReport(completeReport(), full).passed, true)
  const mutations = [
    (report: any) => { report.stockUnmodified = false },
    (report: any) => { report.checks[1].stateStatus = 200 },
    (report: any) => { report.checks[2].clientStatus = 404 },
    (report: any) => { report.checks[3].frontendStatus = 500 },
    (report: any) => { report.checks[0].assets[0].status = 404 },
    (report: any) => { report.checks[0].covers[0].webp = false },
    (report: any) => { report.checks[0].visualDefaults.codeBackground.intensity = 0.2 },
    (report: any) => { report.checks[0].sameValuePut.unchanged = false },
    (report: any) => { report.userStorePreserved = false },
    (report: any) => { report.workspacePreserved = false },
    (report: any) => { report.reenabledShutdown.graceful = false },
    (report: any) => { report.stockSticker.unauthenticatedStatus = 200 },
    (report: any) => { report.liveToggle.disabledApiStatus = 200 },
  ]
  for (const mutate of mutations) {
    const report = completeReport()
    mutate(report)
    assert.equal(verifyInstallReport(report, full).passed, false)
  }
})

test('basic plugin checks do not require the optional artwork pack', () => {
  const report = completeReport()
  report.checks = [report.checks[0]]
  Object.assign(report.checks[0], { assets: [], covers: [], derivedCount: 0, setupNeeded: true, backgroundMode: 'none' })
  assert.equal(verifyInstallReport(report).passed, true)
  assert.equal(verifyInstallReport(report, { expectedAssets: 108 }).passed, false)
})

test('negative reproduction requires the specific unsupported capability and clean shutdown', () => {
  const report = completeReport()
  report.checks = [{ phase: 'enabled', stateStatus: 404, diagnostics: {
    workspaceSetHiddenByOwner: 'undefined', rejectionProbe: 'requires workspaceRegistry.setHiddenByOwner',
  } }]
  assert.equal(verifyInstallReport(report, { expectFailure: true }).passed, true)
  report.checks[0].diagnostics.rejectionProbe = 'unrelated error'
  assert.equal(verifyInstallReport(report, { expectFailure: true }).passed, false)
})
