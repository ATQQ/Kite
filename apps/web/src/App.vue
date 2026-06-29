<script setup lang="ts">
import ToastContainer from './components/ToastContainer.vue'
import CommandPalette from './components/CommandPalette.vue'
</script>

<template>
  <router-view />
  <ToastContainer />
  <CommandPalette />
</template>
