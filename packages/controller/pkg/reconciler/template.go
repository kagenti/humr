package reconciler

import (
	"fmt"

	corev1 "k8s.io/api/core/v1"

	"github.com/kagenti/humr/packages/controller/pkg/types"
)

// TemplateGetter abstracts how templates are looked up — informer lister in prod, map in tests.
type TemplateGetter interface {
	Get(name string) (*corev1.ConfigMap, error)
}

type TemplateResolver struct {
	getter TemplateGetter
}

func NewTemplateResolver(getter TemplateGetter) *TemplateResolver {
	return &TemplateResolver{getter: getter}
}

func (r *TemplateResolver) Resolve(name string) (*types.TemplateSpec, error) {
	cm, err := r.getter.Get(name)
	if err != nil {
		return nil, fmt.Errorf("template %q not found: %w", name, err)
	}
	specYAML, ok := cm.Data["spec.yaml"]
	if !ok {
		return nil, fmt.Errorf("template %q has no spec.yaml", name)
	}
	return types.ParseTemplateSpec(specYAML)
}
