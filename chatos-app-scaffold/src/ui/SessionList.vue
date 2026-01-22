<template>
  <div class="session-list">
    <div class="controls">
      <input v-model="query" type="text" placeholder="Filter sessions" />
      <select v-model="statusFilter">
        <option value="all">All</option>
        <option value="running">Running</option>
        <option value="idle">Idle</option>
        <option value="blocked">Blocked</option>
        <option value="done">Done</option>
      </select>
    </div>

    <ul class="items">
      <li
        v-for="session in filteredSessions"
        :key="session.id"
        :class="{ active: session.id === activeId }"
        @click="selectSession(session.id)"
      >
        <div class="meta">
          <div class="title">{{ session.title || session.id }}</div>
          <div class="sub">{{ session.id }}</div>
        </div>
        <StatusIndicator :status="session.status" :label="session.status" />
      </li>
    </ul>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue';
import StatusIndicator from './components/StatusIndicator.vue';

const props = defineProps({
  sessions: { type: Array, default: () => [] },
  activeId: { type: String, default: '' },
});

const emit = defineEmits(['select']);

const query = ref('');
const statusFilter = ref('all');

const normalizeSession = (session) => {
  const running = Boolean(session?.running);
  const status = (session?.status || (running ? 'running' : 'idle')).toLowerCase();
  return {
    id: session?.id || '',
    title: session?.title || '',
    updatedAt: session?.updatedAt || '',
    status,
  };
};

const filteredSessions = computed(() => {
  const normalized = props.sessions.map(normalizeSession).filter((session) => session.id);
  const q = query.value.trim().toLowerCase();
  const status = statusFilter.value;

  let list = normalized;
  if (q) {
    list = list.filter((session) => session.id.toLowerCase().includes(q) || session.title.toLowerCase().includes(q));
  }
  if (status !== 'all') {
    list = list.filter((session) => session.status === status);
  }

  return list.sort((a, b) => {
    if (a.status === 'running' && b.status !== 'running') return -1;
    if (a.status !== 'running' && b.status === 'running') return 1;
    return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
  });
});

const selectSession = (id) => {
  if (!id) return;
  emit('select', id);
};
</script>

<style scoped>
.session-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  height: 100%;
}

.controls {
  display: flex;
  gap: 8px;
}

.controls input,
.controls select {
  flex: 1;
  padding: 6px 8px;
  border-radius: 10px;
  border: 1px solid rgba(0, 0, 0, 0.12);
  background: #fff;
}

.items {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  overflow: auto;
}

.items li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  border-radius: 12px;
  border: 1px solid rgba(0, 0, 0, 0.08);
  cursor: pointer;
}

.items li.active {
  border-color: #2f80ed;
  box-shadow: 0 0 0 1px rgba(47, 128, 237, 0.2);
}

.meta {
  display: flex;
  flex-direction: column;
}

.title {
  font-weight: 600;
}

.sub {
  font-size: 12px;
  opacity: 0.65;
}
</style>
