import type {Metadata} from 'next';
import {DistrictExplorerApp} from '../../components/district-explorer/DistrictExplorerApp';

export const metadata: Metadata = {
  title: 'District Explorer | Hoodlyfe',
  description: 'Local streamed district walk preview'
};

export default function DistrictExplorerPage() {
  return <DistrictExplorerApp />;
}
