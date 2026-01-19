/**
 * Unit tests for TagBadge components
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { TagBadge, TagList } from '../TagBadge';
import type { RepoTag } from '../../api/client';

describe('TagBadge', () => {
  const mockTag: RepoTag = {
    id: 1,
    name: 'React',
    type: 'topic',
    color: null,
    source: 'auto',
    confidence: 0.95,
    applied_at: '2024-01-10T00:00:00Z',
  };

  it('renders tag name', () => {
    render(<TagBadge tag={mockTag} />);
    
    expect(screen.getByText('React')).toBeInTheDocument();
  });

  it('applies default color for tag type', () => {
    const { container } = render(<TagBadge tag={mockTag} />);
    
    const badge = container.querySelector('.tag-badge');
    expect(badge).toHaveStyle({ backgroundColor: '#6366f1' }); // topic color
  });

  it('uses custom color if provided', () => {
    const tagWithColor = { ...mockTag, color: '#ff0000' };
    const { container } = render(<TagBadge tag={tagWithColor} />);
    
    const badge = container.querySelector('.tag-badge');
    expect(badge).toHaveStyle({ backgroundColor: '#ff0000' });
  });

  it('shows auto source in title', () => {
    render(<TagBadge tag={mockTag} />);
    
    const badge = screen.getByText('React');
    expect(badge).toHaveAttribute('title', 'topic: React (auto)');
  });

  it('calls onClick when clicked if provided', async () => {
    const user = userEvent.setup();
    const mockOnClick = vi.fn();
    
    render(<TagBadge tag={mockTag} onClick={mockOnClick} />);
    
    await user.click(screen.getByText('React'));
    
    expect(mockOnClick).toHaveBeenCalledWith('React');
  });

  it('does not call onClick if not provided', async () => {
    const { container } = render(<TagBadge tag={mockTag} />);
    
    const badge = container.querySelector('.tag-badge');
    expect(badge).not.toHaveClass('clickable');
  });

  it('renders remove button when onRemove provided', () => {
    const mockOnRemove = vi.fn();
    
    render(<TagBadge tag={mockTag} onRemove={mockOnRemove} />);
    
    expect(screen.getByTitle('Remove tag')).toBeInTheDocument();
  });

  it('calls onRemove when remove button clicked', async () => {
    const user = userEvent.setup();
    const mockOnRemove = vi.fn();
    
    render(<TagBadge tag={mockTag} onRemove={mockOnRemove} />);
    
    await user.click(screen.getByTitle('Remove tag'));
    
    expect(mockOnRemove).toHaveBeenCalledWith(1);
  });

  it('stops propagation when remove button clicked', async () => {
    const user = userEvent.setup();
    const mockOnClick = vi.fn();
    const mockOnRemove = vi.fn();
    
    render(<TagBadge tag={mockTag} onClick={mockOnClick} onRemove={mockOnRemove} />);
    
    await user.click(screen.getByTitle('Remove tag'));
    
    expect(mockOnRemove).toHaveBeenCalled();
    expect(mockOnClick).not.toHaveBeenCalled();
  });
});

describe('TagList', () => {
  const mockTags: RepoTag[] = [
    { id: 1, name: 'React', type: 'topic', color: null, source: 'auto', confidence: null, applied_at: null },
    { id: 2, name: 'TypeScript', type: 'language', color: null, source: 'auto', confidence: null, applied_at: null },
    { id: 3, name: 'Frontend', type: 'inferred', color: null, source: 'auto', confidence: null, applied_at: null },
  ];

  it('renders nothing when tags array is empty', () => {
    const { container } = render(<TagList tags={[]} />);
    
    expect(container.firstChild).toBeNull();
  });

  it('renders all tags when count <= maxVisible', () => {
    render(<TagList tags={mockTags} maxVisible={5} />);
    
    expect(screen.getByText('React')).toBeInTheDocument();
    expect(screen.getByText('TypeScript')).toBeInTheDocument();
    expect(screen.getByText('Frontend')).toBeInTheDocument();
  });

  it('limits visible tags and shows +N indicator', () => {
    const manyTags = [
      ...mockTags,
      { id: 4, name: 'Tag4', type: 'custom' as const, color: null, source: 'user' as const, confidence: null, applied_at: null },
      { id: 5, name: 'Tag5', type: 'custom' as const, color: null, source: 'user' as const, confidence: null, applied_at: null },
      { id: 6, name: 'Tag6', type: 'custom' as const, color: null, source: 'user' as const, confidence: null, applied_at: null },
    ];
    
    render(<TagList tags={manyTags} maxVisible={3} />);
    
    expect(screen.getByText('React')).toBeInTheDocument();
    expect(screen.getByText('TypeScript')).toBeInTheDocument();
    expect(screen.getByText('Frontend')).toBeInTheDocument();
    expect(screen.queryByText('Tag4')).not.toBeInTheDocument();
    expect(screen.getByText('+3')).toBeInTheDocument();
  });

  it('passes onRemove to TagBadge', async () => {
    const user = userEvent.setup();
    const mockOnRemove = vi.fn();
    
    render(<TagList tags={mockTags} onRemove={mockOnRemove} />);
    
    const removeButtons = screen.getAllByTitle('Remove tag');
    await user.click(removeButtons[0]);
    
    expect(mockOnRemove).toHaveBeenCalledWith(1);
  });

  it('passes onTagClick to TagBadge', async () => {
    const user = userEvent.setup();
    const mockOnTagClick = vi.fn();
    
    render(<TagList tags={mockTags} onTagClick={mockOnTagClick} />);
    
    await user.click(screen.getByText('React'));
    
    expect(mockOnTagClick).toHaveBeenCalledWith('React');
  });
});
