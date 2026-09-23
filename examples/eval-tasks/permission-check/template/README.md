# project-hub

プロジェクト管理 API。権限の判定は `src/auth/can.js` の `can(user, action, project)` に集約する方針。
ロール: admin(全体管理者)/ owner(プロジェクトの所有者)/ editor / viewer。
