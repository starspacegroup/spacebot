// Who may use which part of a server's dashboard. Pure: the TS wrapper reads Discord and the
// database, reduces them to booleans, and asks these functions. Compiled to JS for
// src/lib/server/feature-access.ts (see scripts/build-dafny.mjs).
//
// `full` means the member is a SpaceBot superadmin, the server owner, or holds Administrator or
// Manage Server. Those members keep every feature. A role grants only the feature it was picked
// for, plus the dashboard door. Nothing here can grant Settings or any other page: the only
// inputs are the four role flags.

module FeatureAccessCore {
  function Full(superAdmin: bool, owner: bool, administrator: bool, manageGuild: bool): bool {
    superAdmin || owner || administrator || manageGuild
  }

  function MayLogs(full: bool, roleLogs: bool): bool { full || roleLogs }
  function MayAutomations(full: bool, roleAutomations: bool): bool { full || roleAutomations }
  function MayCommands(full: bool, roleCommands: bool): bool { full || roleCommands }

  // The dashboard door: any role that grants a feature also lets the member in.
  function MayDashboard(full: bool, roleDashboard: bool, roleLogs: bool, roleAutomations: bool,
                        roleCommands: bool): bool {
    full || roleDashboard || roleLogs || roleAutomations || roleCommands
  }

  // ---- Proofs ----

  lemma FullKeepsEverything(s: bool, o: bool, a: bool, m: bool, rd: bool, rl: bool, ra: bool, rc: bool)
    requires Full(s, o, a, m)
    ensures MayLogs(true, rl) && MayAutomations(true, ra) && MayCommands(true, rc)
    ensures MayDashboard(true, rd, rl, ra, rc)
  {}

  // Empty role lists grant nothing: without full access and without a role, every answer is no.
  lemma NoRolesNoAccess()
    ensures !MayLogs(false, false) && !MayAutomations(false, false) && !MayCommands(false, false)
    ensures !MayDashboard(false, false, false, false, false)
  {}

  // A role for one feature grants that feature and the door, and no other feature.
  lemma LogsRoleIsolated()
    ensures MayLogs(false, true) && MayDashboard(false, false, true, false, false)
    ensures !MayAutomations(false, false) && !MayCommands(false, false)
  {}
  lemma AutomationsRoleIsolated()
    ensures MayAutomations(false, true) && MayDashboard(false, false, false, true, false)
    ensures !MayLogs(false, false) && !MayCommands(false, false)
  {}
  lemma CommandsRoleIsolated()
    ensures MayCommands(false, true) && MayDashboard(false, false, false, false, true)
    ensures !MayLogs(false, false) && !MayAutomations(false, false)
  {}

  // The door is open exactly when something else is: any feature implies the dashboard.
  lemma FeatureImpliesDashboard(full: bool, rd: bool, rl: bool, ra: bool, rc: bool)
    ensures MayLogs(full, rl) ==> MayDashboard(full, rd, rl, ra, rc)
    ensures MayAutomations(full, ra) ==> MayDashboard(full, rd, rl, ra, rc)
    ensures MayCommands(full, rc) ==> MayDashboard(full, rd, rl, ra, rc)
  {}

  // Adding a role never takes access away.
  lemma MoreRolesNeverRemoveAccess(full: bool, rd: bool, rl: bool, ra: bool, rc: bool,
                                   rd2: bool, rl2: bool, ra2: bool, rc2: bool)
    requires rd ==> rd2
    requires rl ==> rl2
    requires ra ==> ra2
    requires rc ==> rc2
    ensures MayLogs(full, rl) ==> MayLogs(full, rl2)
    ensures MayAutomations(full, ra) ==> MayAutomations(full, ra2)
    ensures MayCommands(full, rc) ==> MayCommands(full, rc2)
    ensures MayDashboard(full, rd, rl, ra, rc) ==> MayDashboard(full, rd2, rl2, ra2, rc2)
  {}

  // Without full access, a feature answer depends on its own role only.
  lemma FeatureDependsOnItsOwnRole(rl: bool, ra: bool, rc: bool)
    ensures MayLogs(false, rl) == rl
    ensures MayAutomations(false, ra) == ra
    ensures MayCommands(false, rc) == rc
  {}
}
