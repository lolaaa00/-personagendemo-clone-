<script lang="ts">
  interface Props {
    value: string;
    type?: string;
    placeholder?: string;
    id?: string;
    required?: boolean;
    disabled?: boolean;
    autocomplete?: any;
    class?: string;
    minlength?: number;
  }

  let { 
    value = $bindable(), 
    type = 'text', 
    placeholder = '', 
    id, 
    required = false, 
    disabled = false,
    autocomplete,
    class: className = '',
    minlength
  }: Props = $props();
</script>

<input 
  {id}
  {type}
  {placeholder}
  {required}
  {disabled}
  {autocomplete}
  {minlength}
  bind:value
  class="input-field {className}"
/>
