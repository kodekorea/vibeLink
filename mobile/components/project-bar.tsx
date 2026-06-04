import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { apiGet, getSelectedProject, setSelectedProject, onHostChange } from '@/lib/hub';

interface Project { label: string; path: string; }

export function ProjectBar({ onChange }: { onChange: (path: string) => void }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [sel, setSel] = useState<string | null>(getSelectedProject());

  useEffect(() => {
    function loadProjects() {
      apiGet<{ projects: Project[] }>('/projects')
        .then(r => {
          setProjects(r.projects);
          let s = getSelectedProject();
          if (!s && r.projects[0]) { s = r.projects[0].path; setSelectedProject(s); }
          if (s) { setSel(s); onChange(s); } else { setSel(null); }
        })
        .catch(() => { setProjects([]); });
    }
    loadProjects();
    const off = onHostChange(loadProjects);
    return off;
  }, []);

  function pick(p: string) { setSelectedProject(p); setSel(p); onChange(p); }

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.bar}
      contentContainerStyle={{ gap: 6, paddingHorizontal: 8, alignItems: 'center' }}
    >
      {projects.map(p => (
        <Pressable key={p.path} onPress={() => pick(p.path)} style={[styles.chip, sel === p.path && styles.active]}>
          <Text style={[styles.txt, sel === p.path && styles.txtActive]} numberOfLines={1}>{p.label}</Text>
        </Pressable>
      ))}
      {projects.length === 0 ? <Text style={styles.empty}>즐겨찾기 프로젝트 없음</Text> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  bar: { maxHeight: 46, backgroundColor: '#101010', borderBottomWidth: 1, borderBottomColor: '#222' },
  chip: { paddingHorizontal: 12, paddingVertical: 7, backgroundColor: '#222', borderRadius: 14 },
  active: { backgroundColor: '#2563eb' },
  txt: { color: '#bbb', fontSize: 13, maxWidth: 170 },
  txtActive: { color: '#fff' },
  empty: { color: '#777', fontSize: 12, padding: 10 },
});
