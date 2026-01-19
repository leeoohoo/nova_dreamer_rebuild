export class SessionManager {
  constructor({ onStart, onStop } = {}) {
    this.activeSession = null;
    this.sessionHistory = [];
    this.onStart = typeof onStart === 'function' ? onStart : null;
    this.onStop = typeof onStop === 'function' ? onStop : null;
  }

  async startSession(sessionConfig = {}) {
    if (!sessionConfig.configId) {
      throw new Error('会话配置缺少 configId');
    }
    const session = {
      id: `session_${Date.now()}`,
      configId: sessionConfig.configId,
      configName: sessionConfig.name || '',
      startTime: new Date().toISOString(),
      status: 'starting',
    };
    this.activeSession = session;
    this.sessionHistory.unshift(session);
    if (this.sessionHistory.length > 50) {
      this.sessionHistory = this.sessionHistory.slice(0, 50);
    }
    if (this.onStart) {
      await this.onStart(session);
    }
    session.status = 'running';
    return session;
  }

  async stopSession() {
    if (!this.activeSession) {
      return { ok: false, message: '没有活动的会话' };
    }
    const session = this.activeSession;
    session.status = 'stopping';
    if (this.onStop) {
      await this.onStop(session);
    }
    session.status = 'stopped';
    session.endTime = new Date().toISOString();
    this.activeSession = null;
    return { ok: true, session };
  }

  hasActiveSession() {
    return this.activeSession && this.activeSession.status === 'running';
  }
}
