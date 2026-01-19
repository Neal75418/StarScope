/**
 * Unit tests for ContextBadges component
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ContextBadges } from '../ContextBadges';
import type { ContextBadge } from '../../api/client';

describe('ContextBadges', () => {
  const mockHnBadge: ContextBadge = {
    type: 'hn',
    label: 'HN #1',
    url: 'https://news.ycombinator.com/item?id=123',
    score: 500,
    is_recent: true,
  };

  const mockRedditBadge: ContextBadge = {
    type: 'reddit',
    label: 'r/programming',
    url: 'https://reddit.com/r/programming/123',
    score: 250,
    is_recent: false,
  };

  const mockReleaseBadge: ContextBadge = {
    type: 'release',
    label: 'v2.0.0',
    url: 'https://github.com/facebook/react/releases/tag/v2.0.0',
    score: null,
    is_recent: true,
  };

  it('renders nothing when badges array is empty', () => {
    const { container } = render(<ContextBadges badges={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders HN badge with correct icon and color', () => {
    render(<ContextBadges badges={[mockHnBadge]} />);
    
    const link = screen.getByRole('link', { name: /HN #1/ });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', 'https://news.ycombinator.com/item?id=123');
    expect(link).toHaveStyle({ backgroundColor: '#ff6600' });
    expect(screen.getByText('Y')).toBeInTheDocument();
  });

  it('renders Reddit badge with correct icon and color', () => {
    render(<ContextBadges badges={[mockRedditBadge]} />);
    
    const link = screen.getByRole('link', { name: /r\/programming/ });
    expect(link).toBeInTheDocument();
    expect(link).toHaveStyle({ backgroundColor: '#ff4500' });
    expect(screen.getByText('r/')).toBeInTheDocument();
  });

  it('renders Release badge with correct icon and color', () => {
    render(<ContextBadges badges={[mockReleaseBadge]} />);
    
    const link = screen.getByRole('link', { name: /v2\.0\.0/ });
    expect(link).toBeInTheDocument();
    expect(link).toHaveStyle({ backgroundColor: '#238636' });
    expect(screen.getByText('v')).toBeInTheDocument();
  });

  it('renders multiple badges', () => {
    render(<ContextBadges badges={[mockHnBadge, mockRedditBadge, mockReleaseBadge]} />);
    
    expect(screen.getByText('HN #1')).toBeInTheDocument();
    expect(screen.getByText('r/programming')).toBeInTheDocument();
    expect(screen.getByText('v2.0.0')).toBeInTheDocument();
  });

  it('applies recent class to recent badges', () => {
    render(<ContextBadges badges={[mockHnBadge]} />);
    
    const link = screen.getByRole('link', { name: /HN #1/ });
    expect(link).toHaveClass('recent');
  });

  it('does not apply recent class to non-recent badges', () => {
    render(<ContextBadges badges={[mockRedditBadge]} />);
    
    const link = screen.getByRole('link', { name: /r\/programming/ });
    expect(link).not.toHaveClass('recent');
  });

  it('opens links in new tab', () => {
    render(<ContextBadges badges={[mockHnBadge]} />);
    
    const link = screen.getByRole('link', { name: /HN #1/ });
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });
});
