/**
 * Kit de UI compartilhado do KHUB (Sprint Q1.8).
 *
 * Composição dos tokens/classes do design system (ADR-0036): nenhuma cor
 * literal, nenhum travessão em texto visível (ADR-0037), fonte mínima 11px.
 * Telas novas importam daqui: `import { Button, Modal, useToast } from '@/components/kit'`.
 */
export { ToastProvider, useToast, type ToastApi, type ToastItem, type ToastOpcoes, type ToastTom } from './Toast';
export { Modal, Drawer, Confirm, type ModalProps, type DrawerProps, type ConfirmProps } from './Overlay';
export { Button, Spinner, type ButtonProps, type ButtonVariant, type ButtonSize } from './Button';
export { Select, Switch, Textarea, type SelectProps, type SelectOption, type SwitchProps, type TextareaProps } from './Form';
export { Tabs, TabPanel, type TabsProps, type TabItem } from './Tabs';
export { Skeleton, SkeletonLines, SkeletonRows, SkeletonCards, SkeletonDetail } from './Skeleton';
export { Tooltip, type TooltipProps } from './Tooltip';
export { Menu, type MenuProps, type MenuEntry } from './Menu';
export { useFocusTrap, useScrollLock, focaveis } from './focus';
export { Paginacao, PaginacaoCursor, usePaginacao, janelaDePaginas, TAMANHOS_PAGINA } from './Paginacao';
