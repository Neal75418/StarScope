/**
 * Unit tests for Toast components
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { renderHook, act } from '@testing-library/react';
import { Toast, ToastContainer, useToast, type ToastMessage } from '../Toast';

describe('Toast', () => {
  const mockToast: ToastMessage = {
    id: 'test-1',
    type: 'success',
    message: 'Operation successful',
  };

  const mockOnDismiss = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders toast message', () => {
    render(<Toast toast={mockToast} onDismiss={mockOnDismiss} />);
    
    expect(screen.getByText('Operation successful')).toBeInTheDocument();
  });

  it('shows success icon', () => {
    render(<Toast toast={mockToast} onDismiss={mockOnDismiss} />);
    
    expect(screen.getByText('✓')).toBeInTheDocument();
  });

  it('shows error icon', () => {
    render(<Toast toast={{ ...mockToast, type: 'error' }} onDismiss={mockOnDismiss} />);
    
    expect(screen.getByText('✗')).toBeInTheDocument();
  });

  it('shows info icon', () => {
    render(<Toast toast={{ ...mockToast, type: 'info' }} onDismiss={mockOnDismiss} />);
    
    expect(screen.getByText('ℹ')).toBeInTheDocument();
  });

  it('shows warning icon', () => {
    render(<Toast toast={{ ...mockToast, type: 'warning' }} onDismiss={mockOnDismiss} />);
    
    expect(screen.getByText('⚠')).toBeInTheDocument();
  });

  it.skip('calls onDismiss when close button clicked', async () => {
    const user = userEvent.setup({ delay: null });
    render(<Toast toast={mockToast} onDismiss={mockOnDismiss} />);
    
    const closeButton = screen.getByRole('button');
    await user.click(closeButton);
    
    expect(mockOnDismiss).toHaveBeenCalledWith('test-1');
  });

  it('auto-dismisses after default duration', () => {
    render(<Toast toast={mockToast} onDismiss={mockOnDismiss} />);
    
    expect(mockOnDismiss).not.toHaveBeenCalled();
    
    vi.advanceTimersByTime(4000);
    
    expect(mockOnDismiss).toHaveBeenCalledWith('test-1');
  });

  it('auto-dismisses after custom duration', () => {
    render(<Toast toast={mockToast} onDismiss={mockOnDismiss} duration={2000} />);
    
    vi.advanceTimersByTime(2000);
    
    expect(mockOnDismiss).toHaveBeenCalledWith('test-1');
  });

  it('applies correct CSS class for toast type', () => {
    const { container } = render(<Toast toast={mockToast} onDismiss={mockOnDismiss} />);
    
    expect(container.querySelector('.toast-success')).toBeInTheDocument();
  });
});

describe('ToastContainer', () => {
  const mockToasts: ToastMessage[] = [
    { id: '1', type: 'success', message: 'Success' },
    { id: '2', type: 'error', message: 'Error' },
  ];

  const mockOnDismiss = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders nothing when toasts array is empty', () => {
    const { container } = render(<ToastContainer toasts={[]} onDismiss={mockOnDismiss} />);
    
    expect(container.firstChild).toBeNull();
  });

  it('renders multiple toasts', () => {
    render(<ToastContainer toasts={mockToasts} onDismiss={mockOnDismiss} />);
    
    expect(screen.getByText('Success')).toBeInTheDocument();
    expect(screen.getByText('Error')).toBeInTheDocument();
  });
});

describe('useToast', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('adds success toast', () => {
    const { result } = renderHook(() => useToast());
    
    act(() => {
      result.current.success('Success message');
    });
    
    expect(result.current.toasts).toHaveLength(1);
    expect(result.current.toasts[0].type).toBe('success');
    expect(result.current.toasts[0].message).toBe('Success message');
  });

  it('adds error toast', () => {
    const { result } = renderHook(() => useToast());
    
    act(() => {
      result.current.error('Error message');
    });
    
    expect(result.current.toasts).toHaveLength(1);
    expect(result.current.toasts[0].type).toBe('error');
  });

  it('adds info toast', () => {
    const { result } = renderHook(() => useToast());
    
    act(() => {
      result.current.info('Info message');
    });
    
    expect(result.current.toasts[0].type).toBe('info');
  });

  it('adds warning toast', () => {
    const { result } = renderHook(() => useToast());
    
    act(() => {
      result.current.warning('Warning message');
    });
    
    expect(result.current.toasts[0].type).toBe('warning');
  });

  it('dismisses toast by id', () => {
    const { result } = renderHook(() => useToast());
    
    let toastId: string;
    act(() => {
      toastId = result.current.success('Test');
    });
    
    expect(result.current.toasts).toHaveLength(1);
    
    act(() => {
      result.current.dismissToast(toastId);
    });
    
    expect(result.current.toasts).toHaveLength(0);
  });

  it('generates unique IDs for toasts', () => {
    const { result } = renderHook(() => useToast());
    
    act(() => {
      result.current.success('Message 1');
      result.current.success('Message 2');
    });
    
    expect(result.current.toasts[0].id).not.toBe(result.current.toasts[1].id);
  });
});
