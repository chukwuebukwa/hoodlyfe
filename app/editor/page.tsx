import type {Metadata} from 'next';
import {LevelEditorApp} from '../../components/level-editor/LevelEditorApp';

export const metadata: Metadata = {
  title: 'Level Editor | Hoodlyfe',
  description: 'District world authoring tools'
};

export default function LevelEditorPage() {
  return <LevelEditorApp />;
}
