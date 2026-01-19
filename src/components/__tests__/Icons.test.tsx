/**
 * Unit tests for Icon components
 */

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import {
  StarIcon,
  StarOutlineIcon,
  GearIcon,
  RepoIcon,
  GraphIcon,
  PulseIcon,
  GitCompareIcon,
  SunIcon,
  MoonIcon,
  GlobeIcon,
  PlusIcon,
  SyncIcon,
  XIcon,
  TrashIcon,
  ChartIcon,
  LinkExternalIcon,
  CheckIcon,
  CopyIcon,
  ChevronDownIcon,
} from '../Icons';

describe('Icon Components', () => {
  const icons = [
    { name: 'StarIcon', Component: StarIcon },
    { name: 'StarOutlineIcon', Component: StarOutlineIcon },
    { name: 'GearIcon', Component: GearIcon },
    { name: 'RepoIcon', Component: RepoIcon },
    { name: 'GraphIcon', Component: GraphIcon },
    { name: 'PulseIcon', Component: PulseIcon },
    { name: 'GitCompareIcon', Component: GitCompareIcon },
    { name: 'SunIcon', Component: SunIcon },
    { name: 'MoonIcon', Component: MoonIcon },
    { name: 'GlobeIcon', Component: GlobeIcon },
    { name: 'PlusIcon', Component: PlusIcon },
    { name: 'SyncIcon', Component: SyncIcon },
    { name: 'XIcon', Component: XIcon },
    { name: 'TrashIcon', Component: TrashIcon },
    { name: 'ChartIcon', Component: ChartIcon },
    { name: 'LinkExternalIcon', Component: LinkExternalIcon },
    { name: 'CheckIcon', Component: CheckIcon },
    { name: 'CopyIcon', Component: CopyIcon },
    { name: 'ChevronDownIcon', Component: ChevronDownIcon },
  ];

  icons.forEach(({ name, Component }) => {
    describe(name, () => {
      it('renders with default size', () => {
        const { container } = render(<Component />);
        const svg = container.querySelector('svg');
        expect(svg).toBeInTheDocument();
        expect(svg).toHaveAttribute('width', '16');
        expect(svg).toHaveAttribute('height', '16');
      });

      it('renders with custom size', () => {
        const { container } = render(<Component size={24} />);
        const svg = container.querySelector('svg');
        expect(svg).toHaveAttribute('width', '24');
        expect(svg).toHaveAttribute('height', '24');
      });

      it('applies custom className', () => {
        const { container } = render(<Component className="custom-class" />);
        const svg = container.querySelector('svg');
        expect(svg).toHaveClass('custom-class');
      });
    });
  });
});
