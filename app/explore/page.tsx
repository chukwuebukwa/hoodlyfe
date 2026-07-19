import type {Metadata} from 'next';
import {DistrictExplorerApp} from '../../components/district-explorer/DistrictExplorerApp';

export const metadata: Metadata = {
  title: 'District Explorer | NOCK0',
  description: 'Local streamed district walk preview'
};

export default function DistrictExplorerPage() {
  return <DistrictExplorerApp />;
}
