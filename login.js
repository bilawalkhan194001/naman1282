document.addEventListener('DOMContentLoaded', function () {
    // Password visibility toggle
    const passwordToggle = document.getElementById('passwordToggle');
    const passwordField = document.getElementById('password');

    if (passwordToggle && passwordField) {
        passwordToggle.addEventListener('click', function () {
            const type = passwordField.getAttribute('type') === 'password' ? 'text' : 'password';
            passwordField.setAttribute('type', type);

            // Toggle icon
            const icon = passwordToggle.querySelector('i');
            if (type === 'password') {
                icon.classList.remove('bi-eye-slash');
                icon.classList.add('bi-eye');
            } else {
                icon.classList.remove('bi-eye');
                icon.classList.add('bi-eye-slash');
            }
        });
    }

    // Form submission animation
    const loginForm = document.getElementById('loginForm');

    if (loginForm) {
        loginForm.addEventListener('submit', function (e) {
            const submitButton = this.querySelector('button[type="submit"]');

            if (submitButton) {
                // Disable button and show loading state
                submitButton.disabled = true;
                submitButton.innerHTML = '<span class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span> Signing in...';
            }
        });
    }

    // Focus first input field
    const firstInput = document.querySelector('input');
    if (firstInput) {
        firstInput.focus();
    }
});