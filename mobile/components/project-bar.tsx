import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { apiGet, getSelectedProject, setSelectedProject, onHostChange } from '@/lib/hub';
import { color, radius, font } from '@/lib/theme';

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
  bar: { maxHeight: 46, backgroundColor: color.surfaceSoft, borderBottomWidth: 1, borderBottomColor: color.hairline },
  chip: { paddingHorizontal: 12, paddingVertical: 7, backgroundColor: color.surfaceCard, borderRadius: radius.pill, borderWidth: 1, borderColor: color.hairline },
  active: { backgroundColor: color.primary, borderColor: 'transparent' },
  txt: { color: color.muted, fontSize: 13, maxWidth: 170, fontFamily: font.bodyMedium },
  txtActive: { color: color.onPrimary },
  empty: { color: color.mutedSoft, fontSize: 12, padding: 10 },
});
