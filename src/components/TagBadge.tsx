/**
 * Tag badge component for displaying repo tags.
 */

import { MouseEvent } from "react";
import { RepoTag, TagType } from "../api/client";

interface TagBadgeProps {
  tag: RepoTag;
  onRemove?: (tagId: number) => void;
  onClick?: (tagName: string) => void;
}

// Default colors for tag types
const TYPE_COLORS: Record<TagType, string> = {
  language: "#3572A5",
  topic: "#6366f1",
  inferred: "#8b5cf6",
  custom: "#6b7280",
};

export function TagBadge({ tag, onRemove, onClick }: TagBadgeProps) {
  const backgroundColor = tag.color || TYPE_COLORS[tag.type] || TYPE_COLORS.custom;

  // Calculate text color based on background brightness
  const getTextColor = (bgColor: string): string => {
    // Convert hex to RGB
    const hex = bgColor.replace("#", "");
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);

    // Calculate relative luminance
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;

    return luminance > 0.5 ? "#1f2937" : "#ffffff";
  };

  const textColor = getTextColor(backgroundColor);

  const handleClick = () => {
    if (onClick) {
      onClick(tag.name);
    }
  };

  const handleRemove = (e: MouseEvent) => {
    e.stopPropagation();
    if (onRemove) {
      onRemove(tag.id);
    }
  };

  return (
    <span
      className={`tag-badge ${onClick ? "clickable" : ""}`}
      style={{ backgroundColor, color: textColor }}
      onClick={onClick ? handleClick : undefined}
      title={`${tag.type}: ${tag.name}${tag.source === "auto" ? " (auto)" : ""}`}
    >
      {tag.name}
      {onRemove && (
        <button className="tag-remove-btn" onClick={handleRemove} title="Remove tag">
          &times;
        </button>
      )}
    </span>
  );
}

interface TagListProps {
  tags: RepoTag[];
  onRemove?: (tagId: number) => void;
  onTagClick?: (tagName: string) => void;
  maxVisible?: number;
}

export function TagList({ tags, onRemove, onTagClick, maxVisible = 5 }: TagListProps) {
  const visibleTags = maxVisible ? tags.slice(0, maxVisible) : tags;
  const hiddenCount = tags.length - visibleTags.length;

  if (tags.length === 0) {
    return null;
  }

  return (
    <div className="tag-list">
      {visibleTags.map((tag) => (
        <TagBadge key={tag.id} tag={tag} onRemove={onRemove} onClick={onTagClick} />
      ))}
      {hiddenCount > 0 && (
        <span className="tag-badge tag-more" title={`${hiddenCount} more tags`}>
          +{hiddenCount}
        </span>
      )}
    </div>
  );
}
