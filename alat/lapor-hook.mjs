// Hook Claude Code (SubagentStart / SubagentStop) -> Kantor AI. Dipasang di D:\Ai Agent\.claude\settings.json.
// Membaca JSON hook dari stdin: { hook_event_name, agent_type, agent_id, transcript_path, last_assistant_message }.
// agent_type yang punya meja di Kantor AI: peneliti, analis, penulis, pemeriksa. Agen lain (Explore, Plan, dll.)
// dilaporkan atas nama 'claude-code' supaya tetap kelihatan. Tidak pernah gagal: hook tidak boleh mengganggu sesi.
import fs from 'fs'; import { lapor } from './lapor.mjs';
let masuk = ''; try { masuk = fs.readFileSync(0, 'utf8'); } catch {}
let h = {}; try { h = JSON.parse(masuk || '{}'); } catch {}
// Hanya agen yang benar-benar bekerja yang dilaporkan. Aplikasi Claude Desktop juga menjalankan agen kecil internal
// (tanpa agent_type, mis. pembuat saran balasan) tiap giliran; itu diabaikan supaya papan tidak penuh laporan palsu.
const jenis = String(h.agent_type || h.agent_name || '').toLowerCase();
const DIKENAL = ['peneliti', 'analis', 'penulis', 'pemeriksa', 'explore', 'plan', 'general-purpose', 'claude-code-guide'];
if (!jenis || !DIKENAL.includes(jenis)) process.exit(0);
const kode = ['peneliti', 'analis', 'penulis', 'pemeriksa'].includes(jenis) ? jenis : 'claude-code';
const label = kode === 'claude-code' ? `Agen ${h.agent_type || 'Claude Code'}` : null;
// token dari transkrip subagen (JSONL): jumlah input + output semua pesan assistant. Bisa tertinggal sedikit karena ditulis asinkron.
// Hanya transkrip milik subagen (agent_transcript_path, atau berkas agent-*.jsonl); transkrip sesi induk diabaikan karena isinya seluruh sesi.
function hitungToken(p) { try { if (!p || !/agent-[^\/]*\.jsonl$/i.test(p)) return null; let n = 0; for (const b of fs.readFileSync(p, 'utf8').split('\n')) { if (!b.includes('"usage"')) continue; try { const j = JSON.parse(b); const u = j.usage || j.message?.usage; if (u) n += (u.input_tokens || 0) + (u.output_tokens || 0) + (u.cache_creation_input_tokens || 0); } catch {} } return n || null; } catch { return null; } }
if (h.hook_event_name === 'SubagentStart') await lapor(kode, 'kerja', { tugas: label ? label + ' mulai bekerja' : 'Mengerjakan tugas dari sesi Claude Code', sumber: 'claude-code', jalanId: h.agent_id || null });
else if (h.hook_event_name === 'SubagentStop') await lapor(kode, 'selesai', { tugas: label ? label + ' selesai' : 'Tugas dari sesi Claude Code', hasil: String(h.last_assistant_message || '').replace(/\s+/g, ' ').slice(0, 280) || null, sumber: 'claude-code', jalanId: h.agent_id || null, token: hitungToken(h.agent_transcript_path || h.transcript_path) });
