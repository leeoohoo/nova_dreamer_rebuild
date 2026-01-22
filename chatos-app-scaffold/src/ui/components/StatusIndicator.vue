<template>
  <span class="status" :data-status="normalizedStatus">
    <span class="dot" aria-hidden="true"></span>
    <span class="label">{{ labelText }}</span>
  </span>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({
  status: { type: String, default: 'idle' },
  label: { type: String, default: '' },
});

const normalizedStatus = computed(() => (props.status || 'idle').toLowerCase());
const labelText = computed(() => props.label || normalizedStatus.value);
</script>

<style scoped>
.status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  text-transform: capitalize;
}

.dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: #9aa4b2;
}

.status[data-status='running'] .dot {
  background: #f2b600;
}

.status[data-status='blocked'] .dot {
  background: #ff5c5c;
}

.status[data-status='done'] .dot {
  background: #2fb34a;
}
</style>
