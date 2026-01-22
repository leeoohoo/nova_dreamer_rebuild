<template>
  <div class="app">
    <header class="header">
      <div class="title">ChatOS App Scaffold</div>
      <div class="actions">
        <button type="button" @click="refreshAll" :disabled="loading">Refresh</button>
        <span class="hint" v-if="error">{{ error }}</span>
      </div>
    </header>

    <div class="body">
      <SessionList :sessions="sessions" :active-id="activeSessionId" @select="onSelectSession" />

      <section v-if="!compact" class="panel">
        <div class="panel-header">
          <div class="panel-title">Tasks</div>
          <div class="panel-sub">{{ tasks.length }} total</div>
        </div>
        <ul class="tasks">
          <li v-for="task in tasks" :key="task.id">
            <div class="task-main">
              <div class="task-title">{{ task.type || 'task' }}</div>
              <div class="task-id">{{ task.id }}</div>
            </div>
            <StatusIndicator :status="task.status || 'idle'" :label="task.status || 'idle'" />
          </li>
        </ul>
      </section>
    </div>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import SessionList from './SessionList.vue';
import StatusIndicator from './components/StatusIndicator.vue';

const props = defineProps({
  host: { type: Object, default: null },
  compact: { type: Boolean, default: false },
});

const sessions = ref([]);
const tasks = ref([]);
const activeSessionId = ref('');
const loading = ref(false);
const error = ref('');

const canInvokeBackend = computed(() => Boolean(props.host?.backend?.invoke));

const loadSessions = async () => {
  if (!canInvokeBackend.value) {
    sessions.value = [
      { id: 'session_demo_1', title: 'Demo Session', running: true, updatedAt: new Date().toISOString() },
      { id: 'session_demo_2', title: 'Idle Session', running: false, updatedAt: new Date().toISOString() },
    ];
    return;
  }
  const res = await props.host.backend.invoke('sessions.list');
  sessions.value = Array.isArray(res?.sessions) ? res.sessions : [];
};

const loadTasks = async () => {
  if (!canInvokeBackend.value) {
    tasks.value = [
      { id: 'task_demo', type: 'app_task_run', status: 'running' },
    ];
    return;
  }
  const res = await props.host.backend.invoke('tasks.list');
  tasks.value = Array.isArray(res?.tasks) ? res.tasks : [];
};

const refreshAll = async () => {
  loading.value = true;
  error.value = '';
  try {
    await Promise.all([loadSessions(), loadTasks()]);
  } catch (err) {
    error.value = err?.message || String(err);
  } finally {
    loading.value = false;
  }
};

const onSelectSession = (id) => {
  activeSessionId.value = id;
};

let timer = null;

onMounted(async () => {
  await refreshAll();
  timer = setInterval(refreshAll, 3000);
});

onBeforeUnmount(() => {
  if (timer) clearInterval(timer);
  timer = null;
});
</script>

<style scoped>
.app {
  display: flex;
  flex-direction: column;
  gap: 12px;
  height: 100%;
  padding: 12px;
  box-sizing: border-box;
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}

.title {
  font-size: 16px;
  font-weight: 700;
}

.actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.actions button {
  padding: 6px 10px;
  border-radius: 10px;
  border: 1px solid rgba(0, 0, 0, 0.15);
  background: #fff;
  cursor: pointer;
}

.hint {
  font-size: 12px;
  color: #d14a4a;
}

.body {
  display: grid;
  grid-template-columns: 320px 1fr;
  gap: 12px;
  flex: 1;
  min-height: 0;
}

.panel {
  border: 1px solid rgba(0, 0, 0, 0.1);
  border-radius: 12px;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 0;
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
}

.panel-title {
  font-weight: 600;
}

.panel-sub {
  font-size: 12px;
  opacity: 0.6;
}

.tasks {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  overflow: auto;
}

.tasks li {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 10px;
  border-radius: 10px;
  border: 1px solid rgba(0, 0, 0, 0.08);
}

.task-main {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.task-title {
  font-weight: 600;
}

.task-id {
  font-size: 12px;
  opacity: 0.65;
}
</style>
