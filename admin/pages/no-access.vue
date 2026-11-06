<script setup lang="ts">
const { clear } = useAuth();
async function logout() {
  clear();
  await navigateTo("/login");
}
</script>

<template>
  <section class="panel" style="max-width: 460px">
    <h1 style="margin: 0; font-size: 20px">Ruxsat yo'q</h1>
    <p class="muted" style="margin: 0">
      Hisobingizga hali hech qanday rol/ruxsat berilmagan. Administratorga murojaat qiling.
    </p>
    <div><button class="btn" @click="logout">Chiqish</button></div>
  </section>
</template>
